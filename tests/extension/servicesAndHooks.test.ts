/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  domainFor,
  faviconFor,
  getTabInfo,
  requestTabTools,
  executeTabTool,
} from '../../extension/sidepanel/services/extensionBridge.js';
import { waitForToolsToSettle } from '../../extension/sidepanel/services/toolResults.js';
import { buildContentScript } from './contentScriptSource.js';

function setupTestChrome() {
  const listeners: Array<(message: unknown, sender: unknown) => void> = [];
  globalThis.chrome = {
    tabs: {
      get: async (tabId: number) =>
        tabId === 1
          ? ({ id: 1, url: 'https://example.com', favIconUrl: 'https://example.com/favicon.ico' } as chrome.tabs.Tab)
          : (undefined as unknown as chrome.tabs.Tab),
      query: async () => [
        { id: 1, url: 'https://example.com', favIconUrl: 'https://example.com/favicon.ico' },
      ] as chrome.tabs.Tab[],
      sendMessage: async (_tabId: number, _message: unknown) => ({ success: true }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    } as unknown as typeof chrome.tabs,
    runtime: {
      onMessage: {
        addListener: (cb: (message: unknown, sender: unknown) => void) => listeners.push(cb),
        removeListener: (cb: (message: unknown, sender: unknown) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
        },
      },
      sendMessage: async () => {},
      getURL: (path: string) => `chrome-extension://test-extension-id${path}`,
    } as unknown as typeof chrome.runtime,
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
    } as unknown as typeof chrome.webNavigation,
  } as typeof chrome;
}

test('extensionBridge - getTabInfo, domainFor, and faviconFor return tab metadata and fallback favicons', async () => {
  setupTestChrome();
  const info = await getTabInfo(1);
  assert.ok(info);
  assert.equal(info.tabId, 1);
  assert.equal(info.domain, 'example.com');
  assert.equal(info.favicon, 'https://example.com/favicon.ico');
  assert.equal(domainFor('https://shop.example/path'), 'shop.example');
  assert.equal(domainFor(''), 'New Tab');
  assert.equal(
    faviconFor('https://shop.example/path'),
    'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fshop.example%2Fpath&size=32'
  );
  assert.equal(faviconFor(''), '');
});

test('extensionBridge - requestTabTools dispatches LIST_TOOLS message to active tab', async () => {
  setupTestChrome();
  let dispatchedMessage: unknown = null;
  globalThis.chrome.tabs.sendMessage = async (_tabId: number, message: unknown) => {
    dispatchedMessage = message;
    return { success: true };
  };

  await requestTabTools(1);
  assert.ok(dispatchedMessage);
  assert.equal((dispatchedMessage as { action: string }).action, 'LIST_TOOLS');
});


test('backendBridge - streamChat supports AbortSignal cancellation', async () => {
  const { streamChat } = await import('../../extension/sidepanel/services/backendBridge.js');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await streamChat('/api/chat', {}, { signal: controller.signal });
    },
    (err: Error) => err.name === 'AbortError' || err.message.includes('aborted')
  );
});

test('backendBridge - formatErrorMessage unwraps nested JSON error strings and strips debug details', async () => {
  const { formatErrorMessage } = await import('../../extension/sidepanel/services/backendBridge.js');

  // Plain strings remain unchanged
  assert.equal(formatErrorMessage('Backend server error'), 'Backend server error');

  // Synthetic nested JSON error payload with code, status, and internal details array
  const innerJson = JSON.stringify({
    error: {
      code: 503,
      message: 'Service temporarily unavailable. Please retry.',
      status: 'UNAVAILABLE',
      details: [{ '@type': 'synthetic.debug', detail: 'internal-trace-data-token' }],
    },
  });
  const outerPayload = `Streaming error: ${JSON.stringify({ error: { message: innerJson } })}`;

  assert.equal(
    formatErrorMessage(outerPayload),
    'Streaming error: Service temporarily unavailable. Please retry. (503 UNAVAILABLE)'
  );
});

test('extensionBridge - executeTabTool dispatches message to tab with appropriate frame options', async () => {
  setupTestChrome();
  const sentMessages: Array<{ tabId: number; message: unknown; options?: unknown }> = [];
  const mockChrome = (globalThis as any).chrome;
  const origSendMessage = mockChrome.tabs.sendMessage;

  try {
    mockChrome.tabs.sendMessage = async (tabId: number, message: unknown, options?: unknown) => {
      sentMessages.push({ tabId, message, options });
      return { success: true, count: 42 };
    };

    // 1. Execute tool in the main frame
    const resMain = await executeTabTool('search_hotels', { query: 'hotel' }, 0, 1);
    assert.deepEqual(resMain, { success: true, count: 42 });
    assert.equal(sentMessages[0].tabId, 1);
    assert.deepEqual(sentMessages[0].options, { frameId: 0 });
    assert.deepEqual((sentMessages[0].message as any).inputArgs, { query: 'hotel' });

    // 2. Execute tool in a cross-origin iframe
    const resIframe = await executeTabTool('submit_booking', { id: 123 }, 1, 1);
    assert.deepEqual(resIframe, { success: true, count: 42 });
    assert.deepEqual(sentMessages[1].options, { frameId: 1 });
    assert.deepEqual((sentMessages[1].message as any).inputArgs, { id: 123 });
  } finally {
    mockChrome.tabs.sendMessage = origSendMessage;
  }
});

test('extensionBridge - getTabInfo returns null when tab does not exist', async () => {
  setupTestChrome();
  const info = await getTabInfo(999);
  assert.equal(info, null);
});

test('extensionBridge - executeTabTool throws error when chrome.tabs is unavailable', async () => {
  const origTabs = globalThis.chrome.tabs;
  try {
    (globalThis.chrome as { tabs?: unknown }).tabs = undefined;
    await assert.rejects(
      async () => {
        await executeTabTool('search', {}, 0, 1);
      },
      { message: 'No active tab available for tool execution.' }
    );
  } finally {
    globalThis.chrome.tabs = origTabs;
  }
});

test('content script - EXECUTE_TOOL tries object inputArgs first and falls back to JSON string on parse error', async () => {
  setupTestChrome();
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  let messageListener: ((message: any, sender: any, reply: (res: any) => void) => void) | null = null;
  globalThis.chrome.runtime.onMessage.addListener = (cb: any) => {
    messageListener = cb;
  };
  globalThis.chrome.runtime.sendMessage = async () => {};

  const mockWindow: any = {
    location: { href: 'https://example.com' },
    addEventListener: () => {},
  };
  mockWindow.top = mockWindow;
  globalThis.window = mockWindow;

  const executedArgs: unknown[] = [];
  // Every form target the content script resolves from a tool name.
  const resolvedTargets: string[] = [];
  let mode: 'object' | 'string-fallback' | 'error' = 'object';

  // A page with two tool-bound forms, so a tool name that tries to match more
  // than its own form has something to wrongly match.
  const makeForm = (toolname: string, target: string) => ({
    getAttribute: (attr: string) => (attr === 'toolname' ? toolname : null),
    target,
  });
  const forms = [makeForm('book_room', 'book_frame'), makeForm('cancel_room', 'cancel_frame')];

  const mockTool = { name: 'book_room', window: mockWindow };
  globalThis.document = {
    forms,
    getElementsByName: (name: string) => {
      resolvedTargets.push(name);
      return [];
    },
    querySelector: () => null,
    modelContext: {
      getTools: async () => [mockTool],
      executeTool: async (_tool: unknown, args: unknown) => {
        executedArgs.push(args);
        if (mode === 'error') {
          throw new Error('Unexpected execution error');
        }
        if (mode === 'string-fallback' && typeof args !== 'string') {
          throw new Error('Failed to parse input: expected JSON string');
        }
        return { booked: true, receivedArgs: args };
      },
    },
  } as unknown as Document;

  try {
    new Function(buildContentScript())();
    assert.ok(messageListener, 'Content script should register an onMessage listener');

    // 1. Object-first path succeeds directly without fallback
    mode = 'object';
    executedArgs.length = 0;
    const res1 = await new Promise((resolve) => {
      messageListener!({ action: 'EXECUTE_TOOL', name: 'book_room', inputArgs: { id: 42 } }, {}, resolve);
    });
    assert.deepEqual(res1, { booked: true, receivedArgs: { id: 42 } });
    assert.deepEqual(executedArgs, [{ id: 42 }]);

    // 2. Fallback path: object throws 'Failed to parse input...', catches and retries with JSON string
    mode = 'string-fallback';
    executedArgs.length = 0;
    const res2 = await new Promise((resolve) => {
      messageListener!({ action: 'EXECUTE_TOOL', name: 'book_room', inputArgs: { id: 42 } }, {}, resolve);
    });
    assert.deepEqual(res2, { booked: true, receivedArgs: '{"id":42}' });
    assert.deepEqual(executedArgs, [{ id: 42 }, '{"id":42}']);

    // 3. Rethrow path: other errors are not retried and reply with stringified message
    mode = 'error';
    executedArgs.length = 0;
    const res3 = await new Promise((resolve) => {
      messageListener!({ action: 'EXECUTE_TOOL', name: 'book_room', inputArgs: { id: 42 } }, {}, resolve);
    });
    assert.equal(res3, JSON.stringify('Unexpected execution error'));
    assert.deepEqual(executedArgs, [{ id: 42 }]);

    // 4. Tool names come from the page. A name crafted to look like selector
    // syntax must simply not match, rather than matching another tool's form.
    mode = 'object';
    resolvedTargets.length = 0;
    await new Promise((resolve) => {
      messageListener!(
        { action: 'EXECUTE_TOOL', name: 'a"], form[toolname="cancel_room', inputArgs: {} },
        {},
        resolve
      );
    });
    assert.deepEqual(
      resolvedTargets,
      [],
      `hostile tool name matched a form: ${JSON.stringify(resolvedTargets)}`
    );

    // ...while the honest name still resolves its own form.
    resolvedTargets.length = 0;
    await new Promise((resolve) => {
      messageListener!({ action: 'EXECUTE_TOOL', name: 'book_room', inputArgs: {} }, {}, resolve);
    });
    assert.deepEqual(resolvedTargets, ['book_frame']);
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  }
});

test('waitForToolsToSettle waits for tools a page registers late, until their reports pause', async () => {
  const toolsRef = { current: [{ name: 'search_location' }] };
  const report = (names: string[]) => {
    toolsRef.current = names.map((name) => ({ name }));
  };
  let requested = 0;
  const start = performance.now();

  // Like the hotel demo: the new view's tools come in a while after the call,
  // and one more follows shortly after.
  setTimeout(() => report(['search_location', 'get_current_search_results']), 150);
  setTimeout(() => report(['search_location', 'get_current_search_results', 'filter_search_results']), 200);

  await waitForToolsToSettle(toolsRef, {
    requestTools: async () => {
      requested++;
    },
    quietMs: 100,
    timeoutMs: 1000,
    pollMs: 5,
  });

  const elapsed = performance.now() - start;
  assert.equal(requested, 1);
  assert.deepEqual(
    toolsRef.current.map((tool) => tool.name),
    ['search_location', 'get_current_search_results', 'filter_search_results']
  );
  // Not before the last report plus the quiet period, and well before the timeout.
  assert.ok(elapsed >= 300, `returned after ${elapsed}ms`);
  assert.ok(elapsed < 800, `returned after ${elapsed}ms`);
});

test('waitForToolsToSettle gives up when no tools are reported, and stops when aborted', async () => {
  const toolsRef = { current: [] };
  const options = { requestTools: async () => {}, quietMs: 50, pollMs: 5 };

  let start = performance.now();
  await waitForToolsToSettle(toolsRef, { ...options, timeoutMs: 150 });
  let elapsed = performance.now() - start;
  assert.ok(elapsed >= 150 && elapsed < 400, `timed out after ${elapsed}ms`);

  // A request that cannot reach the page is no reason to throw.
  await waitForToolsToSettle(toolsRef, {
    ...options,
    timeoutMs: 20,
    requestTools: async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
  });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  start = performance.now();
  await waitForToolsToSettle(toolsRef, { ...options, timeoutMs: 5000, signal: controller.signal });
  elapsed = performance.now() - start;
  assert.ok(elapsed < 300, `stopped after ${elapsed}ms`);
});

function ndjsonStreamResponse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < body.length; i += 7) controller.enqueue(encoder.encode(body.slice(i, i + 7)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
}

test('backendBridge - streamChat reports text as it arrives and resolves with the turn response', async () => {
  const { streamChat } = await import('../../extension/sidepanel/services/backendBridge.js');
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown; headers: Headers }> = [];
  try {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
      return ndjsonStreamResponse([
        { delta: 'Hello, ' },
        { delta: 'wörld.' },
        { done: true, chatId: 'chat-1', text: 'Hello, wörld.', functionCalls: [] },
      ]);
    }) as typeof fetch;

    const seen: string[] = [];
    const reply = await streamChat('/api/chat', { message: 'Hi', tools: [] }, { onText: (text) => seen.push(text) });

    assert.deepEqual(seen, ['Hello, ', 'Hello, wörld.']);
    assert.equal(reply.text, 'Hello, wörld.');
    assert.equal(reply.chatId, 'chat-1');
    assert.deepEqual(requests[0].body, { message: 'Hi', tools: [] });
    assert.equal(requests[0].headers.get('Content-Type'), 'application/json');

    globalThis.fetch = (async () =>
      ndjsonStreamResponse([
        {
          done: true,
          chatId: 'chat-1',
          text: '',
          functionCalls: [{ id: 'c1', name: 'book_table', args: { size: 2 } }],
        },
      ])) as typeof fetch;
    const called = await streamChat('/api/chat', { message: 'Book' });
    assert.deepEqual(called.functionCalls, [{ id: 'c1', name: 'book_table', args: { size: 2 } }]);

    globalThis.fetch = (async () =>
      ndjsonStreamResponse([
        { delta: 'Hel' },
        { error: 'Quota exceeded' },
      ])) as typeof fetch;
    await assert.rejects(() => streamChat('/api/chat', { message: 'Hi' }), { message: 'Quota exceeded' });

    const dying = (error: Error) => () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"delta":"Hel"}\n'));
            controller.error(error);
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } }
      );
    globalThis.fetch = dying(new TypeError('fetch failed')) as unknown as typeof fetch;
    await assert.rejects(() => streamChat('/api/chat', { message: 'Hi' }), /Lost the connection/);

    const controller = new AbortController();
    globalThis.fetch = (() => {
      controller.abort();
      return dying(new DOMException('The operation was aborted.', 'AbortError'))();
    }) as unknown as typeof fetch;
    await assert.rejects(() => streamChat('/api/chat', { message: 'Hi' }, { signal: controller.signal }), {
      name: 'AbortError',
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    await assert.rejects(() => streamChat('/api/chat', { message: 'Hi' }), { message: 'Unauthorized' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

