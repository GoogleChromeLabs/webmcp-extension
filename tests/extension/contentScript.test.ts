/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { buildContentScript } from './contentScriptSource.js';

// `extension/content.ts` is a content script, not a module the tests can import: it
// touches `window`, `document` and `chrome` at the top level and exports
// nothing. It is built with the release esbuild options and run in a
// `node:vm` sandbox instead, so the tests assert on the actual shipped code.
// That matters most for the annotation hints: if the projection below ever
// stops forwarding `consequentialHint`, every downstream consequential-action
// guard silently turns into a no-op, because the side panel would simply never
// see the hint.

const CONTENT_SCRIPT = buildContentScript();

interface SentMessage {
  tools?: unknown[];
  url?: string;
  message?: string;
}

interface FakeTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: Record<string, unknown>;
  window: unknown;
}

/**
 * Loads the real content script into an isolated sandbox and returns the
 * handles a test needs to drive it: the message listener it registered and the
 * list of messages it sent back to the extension.
 */
function loadContentScript(tools: FakeTool[], href: string) {

  const sent: SentMessage[] = [];
  let listener: ((message: unknown, sender: unknown, reply: unknown) => unknown) | undefined;

  const win: Record<string, unknown> = {
    location: { href },
    addEventListener() {},
    removeEventListener() {},
  };
  // The script only announces itself from the top frame, and it decides a tool
  // is same-frame via `tool.window == window`, so the tools must reference the
  // very object the sandbox exposes as `window`.
  win.top = win;
  for (const tool of tools) tool.window = win;

  const sandbox: Record<string, unknown> = {
    window: win,
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    document: {
      modelContext: {
        ontoolchange: undefined,
        getTools: async () => tools,
      },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn: (message: unknown, sender: unknown, reply: unknown) => unknown) {
            listener = fn;
          },
        },
        sendMessage(message: SentMessage) {
          sent.push(message);
          // The real API returns a promise; the script chains `.catch()` on it.
          return Promise.resolve();
        },
      },
    },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(CONTENT_SCRIPT, sandbox, { filename: 'content.js' });

  assert.ok(listener, 'content script should register a chrome.runtime.onMessage listener');
  return { sent, listener: listener! };
}

/** Waits for the debounced `listTools` call to publish its message. */
async function waitForTools(sent: SentMessage[]): Promise<SentMessage> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const message = sent.find((m) => Array.isArray(m.tools));
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`content script never sent a tools message; sent: ${JSON.stringify(sent)}`);
}

test('content script forwards every annotation hint the permission gate relies on', async () => {
  const { sent, listener } = loadContentScript(
    [
      {
        name: 'place_order',
        description: 'Places the order and charges the card.',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          consequentialHint: true,
          readOnlyHint: false,
          untrustedContentHint: true,
        },
        window: null,
      },
    ],
    'https://shop.example/checkout',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  assert.equal(message.url, 'https://shop.example/checkout');
  // Round-tripped through JSON because the sandbox has its own realm, so its
  // objects fail `deepStrictEqual`'s prototype check despite being identical.
  assert.deepEqual(JSON.parse(JSON.stringify(message.tools)), [
    {
      description: 'Places the order and charges the card.',
      inputSchema: { type: 'object', properties: {} },
      readOnlyHint: false,
      untrustedContentHint: true,
      consequentialHint: true,
      name: 'place_order',
      frameId: 0,
    },
  ]);
});

test('content script preserves a false consequentialHint rather than dropping it', async () => {
  const { sent, listener } = loadContentScript(
    [
      {
        name: 'search_products',
        description: 'Searches the catalogue.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { consequentialHint: false, readOnlyHint: true },
        window: null,
      },
    ],
    'https://shop.example/',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  const [tool] = message.tools as Array<Record<string, unknown>>;
  assert.equal(tool.consequentialHint, false);
  assert.equal(tool.readOnlyHint, true);
});

test('content script leaves consequentialHint undefined when a page omits annotations', async () => {
  const { sent, listener } = loadContentScript(
    [
      {
        name: 'legacy_tool',
        description: 'A tool from a page that predates annotations.',
        inputSchema: { type: 'object', properties: {} },
        window: null,
      },
    ],
    'https://legacy.example/',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  const [tool] = message.tools as Array<Record<string, unknown>>;
  // Undefined, not `false`: the side panel must be able to tell "the page said
  // this is safe" apart from "the page said nothing".
  assert.equal(tool.consequentialHint, undefined);
  assert.ok('consequentialHint' in tool);
});
