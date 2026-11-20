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

interface FakeToolInit {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  /** Defaults to the sandbox `window`, i.e. a tool of the frame itself. */
  source?: unknown;
}

/**
 * Fakes a `Tool` as returned by `getTools()` since Chrome 160: an interface
 * object whose attributes are getters on the prototype, so it has no own
 * properties, and a missing schema or annotations is null.
 */
class FakeTool {
  readonly #init: FakeToolInit;
  readonly #source: unknown;
  constructor(init: FakeToolInit, source: unknown) {
    this.#init = init;
    this.#source = source;
  }
  get name() { return this.#init.name; }
  get title() { return ''; }
  get description() { return this.#init.description; }
  get inputSchema() { return this.#init.inputSchema ?? null; }
  get outputSchema() { return this.#init.outputSchema ?? null; }
  get annotations() { return this.#init.annotations ?? null; }
  get origin() { return ''; }
  get source() { return this.#source; }
}

/**
 * Loads the real content script into an isolated sandbox and returns the
 * handles a test needs to drive it: the message listener it registered and the
 * list of messages it sent back to the extension.
 */
function loadContentScript(tools: FakeToolInit[], href: string) {

  const sent: SentMessage[] = [];
  let listener: ((message: unknown, sender: unknown, reply: unknown) => unknown) | undefined;

  const win: Record<string, unknown> = {
    location: { href },
    addEventListener() {},
    removeEventListener() {},
  };
  // The script only announces itself from the top frame, and it decides a tool
  // is same-frame via `tool.source == window`, so the tools must reference the
  // very object the sandbox exposes as `window`.
  win.top = win;
  const pageTools = tools.map((init) => new FakeTool(init, 'source' in init ? init.source : win));

  const sandbox: Record<string, unknown> = {
    window: win,
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    document: {
      modelContext: {
        ontoolchange: undefined,
        getTools: async () => pageTools,
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

test('content script forwards the output schema', async () => {
  const outputSchema = { type: 'object', properties: { temperature: { type: 'number' } } };
  const { sent, listener } = loadContentScript(
    [
      {
        name: 'get_weather',
        description: 'Gets the weather.',
        inputSchema: { type: 'object', properties: {} },
        outputSchema,
      },
    ],
    'https://weather.example/',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  const [tool] = JSON.parse(JSON.stringify(message.tools)) as Array<Record<string, unknown>>;
  assert.deepEqual(tool.outputSchema, outputSchema);
});

test('content script turns null schemas into undefined', async () => {
  const { sent, listener } = loadContentScript(
    [{ name: 'bare', description: 'No schema.' }],
    'https://bare.example/',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  const [tool] = message.tools as Array<Record<string, unknown>>;
  assert.equal(tool.inputSchema, undefined);
  assert.equal(tool.outputSchema, undefined);
  assert.equal(tool.frameId, 0);
});

test('content script skips a tool whose source document is gone', async () => {
  const { sent, listener } = loadContentScript(
    [
      { name: 'gone', description: 'Navigated away.', source: null },
      { name: 'here', description: 'Still here.' },
    ],
    'https://shop.example/',
  );

  listener({ action: 'LIST_TOOLS' }, {}, () => {});
  const message = await waitForTools(sent);

  const tools = JSON.parse(JSON.stringify(message.tools)) as Array<Record<string, unknown>>;
  assert.deepEqual(tools.map((tool) => tool.name), ['here']);
});
