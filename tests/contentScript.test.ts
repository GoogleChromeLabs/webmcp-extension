/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// `extension/content.js` is a declaratively injected content script, not an ES
// module: the manifest lists it under `content_scripts[].js` and the build
// copies `extension/` verbatim, so it cannot use `import` and therefore cannot
// export anything for a test to call. It also touches `window`, `document` and
// `chrome` at the top level, so it cannot simply be imported either.
//
// Running the real file in a `node:vm` sandbox is what lets us assert on the
// actual shipped code rather than on a copy of it. That matters most for the
// annotation hints: if the projection below ever stops forwarding
// `consequentialHint`, every downstream consequential-action guard silently
// turns into a no-op, because the side panel would simply never see the hint.

const CONTENT_SCRIPT_PATH = path.resolve(process.cwd(), 'extension/content.js');

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
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf8');

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
  vm.runInContext(source, sandbox, { filename: CONTENT_SCRIPT_PATH });

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
  const tools = JSON.parse(JSON.stringify(message.tools)) as Array<Record<string, unknown>>;
  const placeOrder = tools.find((t) => t.name === 'place_order');
  assert.deepEqual(placeOrder, {
    description: 'Places the order and charges the card.',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: false,
    untrustedContentHint: true,
    consequentialHint: true,
    name: 'place_order',
    frameId: 0,
  });

  const readPageContent = tools.find((t) => t.name === 'read_page_content');
  assert.ok(readPageContent);
  assert.equal(readPageContent.readOnlyHint, true);

  const queryDom = tools.find((t) => t.name === 'query_dom_elements');
  assert.ok(queryDom);
  assert.equal(queryDom.readOnlyHint, true);
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

  const tools = message.tools as Array<Record<string, unknown>>;
  const tool = tools.find((t) => t.name === 'search_products');
  assert.ok(tool);
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

  const tools = message.tools as Array<Record<string, unknown>>;
  const tool = tools.find((t) => t.name === 'legacy_tool');
  assert.ok(tool);
  // Undefined, not `false`: the side panel must be able to tell "the page said
  // this is safe" apart from "the page said nothing".
  assert.equal(tool.consequentialHint, undefined);
  assert.ok('consequentialHint' in tool);
});

test('content script executes read_page_content and query_dom_elements built-in tools', async () => {
  const { listener } = loadContentScript([], 'https://example.com/article');

  // Test read_page_content execution
  const readResult = await new Promise<Record<string, unknown>>((resolve) => {
    listener({ action: 'EXECUTE_TOOL', name: 'read_page_content', inputArgs: { maxCharacters: 5000 } }, {}, resolve);
  });
  assert.equal(readResult.url, 'https://example.com/article');
  assert.equal(typeof readResult.content, 'string');
  assert.equal(readResult.truncated, false);

  // Test query_dom_elements execution
  const queryResult = await new Promise<Record<string, unknown>>((resolve) => {
    listener({ action: 'EXECUTE_TOOL', name: 'query_dom_elements', inputArgs: { selector: 'h1' } }, {}, resolve);
  });
  assert.equal(queryResult.selector, 'h1');
  assert.ok(Array.isArray(queryResult.results));
});

test('content script provides built-in tools on regular websites without document.modelContext', async () => {
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf8');
  const sent: SentMessage[] = [];
  let listener: ((message: unknown, sender: unknown, reply: unknown) => unknown) | undefined;

  const win: Record<string, unknown> = {
    location: { href: 'https://en.wikipedia.org/wiki/Web_browser' },
    addEventListener() {},
    removeEventListener() {},
  };
  win.top = win;

  const sandbox: Record<string, unknown> = {
    window: win,
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    document: {
      title: 'Web browser - Wikipedia',
      // No modelContext at all
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
          return Promise.resolve();
        },
      },
    },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: CONTENT_SCRIPT_PATH });

  assert.ok(listener);
  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  assert.equal(message.url, 'https://en.wikipedia.org/wiki/Web_browser');
  const tools = message.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, 'read_page_content');
  assert.equal(tools[1].name, 'query_dom_elements');
});
