/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveTabInfo, requestTabTools, executeTabTool } from '../src/services/extensionBridge.js';
import { waitForToolsToSettle } from '../src/hooks/useAgentSession.js';

function setupTestChrome() {
  const listeners: Array<(message: unknown, sender: unknown) => void> = [];
  globalThis.chrome = {
    tabs: {
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
    } as unknown as typeof chrome.runtime,
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
    } as unknown as typeof chrome.webNavigation,
  } as typeof chrome;
}

test('extensionBridge - getActiveTabInfo returns tab metadata when chrome.tabs is available', async () => {
  setupTestChrome();
  const info = await getActiveTabInfo();
  assert.ok(info);
  assert.equal(info.tabId, 1);
  assert.equal(info.domain, 'example.com');
  assert.equal(info.favicon, 'https://example.com/favicon.ico');
});

test('extensionBridge - requestTabTools dispatches LIST_TOOLS message to active tab', async () => {
  setupTestChrome();
  let dispatchedMessage: unknown = null;
  globalThis.chrome.tabs.sendMessage = async (_tabId: number, message: unknown) => {
    dispatchedMessage = message;
    return { success: true };
  };

  await requestTabTools();
  assert.ok(dispatchedMessage);
  assert.equal((dispatchedMessage as { action: string }).action, 'LIST_TOOLS');
});

test('backendBridge - callBackend correctly makes fetch requests and handles backend responses', async () => {
  const { callBackend } = await import('../src/services/backendBridge.js');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/model')) {
        return {
          json: async () => ({ success: true, model: 'gemini-3.6-flash' }),
        } as Response;
      }
      if (urlStr.endsWith('/api/error')) {
        return {
          json: async () => ({ error: 'Backend server error' }),
        } as Response;
      }
      return {
        json: async () => ({ success: true }),
      } as Response;
    };

    const res = await callBackend<{ success: boolean; model: string }>('/api/model', { model: 'gemini-3.6-flash' });
    assert.equal(res.success, true);
    assert.equal(res.model, 'gemini-3.6-flash');

    await assert.rejects(
      async () => {
        await callBackend('/api/error');
      },
      { message: 'Backend server error' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

    // 1. Execute tool in main frame with string inputArgs
    const resMain = await executeTabTool('search_hotels', '{"query":"hotel"}', 0);
    assert.deepEqual(resMain, { success: true, count: 42 });
    assert.equal(sentMessages[0].tabId, 1);
    assert.deepEqual(sentMessages[0].options, { frameId: 0 });
    assert.deepEqual((sentMessages[0].message as any).inputArgs, '{"query":"hotel"}');

    // 2. Execute tool in cross-origin iframe with object inputArgs
    const resIframe = await executeTabTool('submit_booking', { id: 123 }, 1);
    assert.deepEqual(resIframe, { success: true, count: 42 });
    assert.deepEqual(sentMessages[1].options, { frameId: 1 });
    assert.deepEqual((sentMessages[1].message as any).inputArgs, { id: 123 });
  } finally {
    mockChrome.tabs.sendMessage = origSendMessage;
  }
});

test('backendBridge - callBackend supports AbortSignal cancellation', async () => {
  const { callBackend } = await import('../src/services/backendBridge.js');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await callBackend('/api/model', {}, { signal: controller.signal });
    },
    (err: Error) => err.name === 'AbortError' || err.message.includes('aborted')
  );
});

test('extensionBridge - getActiveTabInfo returns null when no active tab exists', async () => {
  setupTestChrome();
  const origQuery = globalThis.chrome.tabs.query;
  try {
    globalThis.chrome.tabs.query = async () => [];
    const info = await getActiveTabInfo();
    assert.equal(info, null);
  } finally {
    globalThis.chrome.tabs.query = origQuery;
  }
});

test('extensionBridge - executeTabTool throws error when chrome.tabs is unavailable', async () => {
  const origTabs = globalThis.chrome.tabs;
  try {
    (globalThis.chrome as { tabs?: unknown }).tabs = undefined;
    await assert.rejects(
      async () => {
        await executeTabTool('search', '{}', 0);
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
  let mode: 'object' | 'string-fallback' | 'error' = 'object';

  const mockTool = { name: 'book_room', window: mockWindow };
  globalThis.document = {
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
    const fs = await import('node:fs');
    const contentScript = fs.readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf-8');
    new Function(contentScript)();
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
