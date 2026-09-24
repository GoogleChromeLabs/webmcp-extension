/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { useAgentSession, UseAgentSessionOptions, UseAgentSessionReturn } from '../src/sidepanel/hooks/useAgentSession.js';
import { useActiveTabTools } from '../src/sidepanel/hooks/useActiveTabTools.js';
import { useActiveTabId } from '../src/sidepanel/hooks/useActiveTabId.js';
import { requestTabTools, executeTabTool, getTabInfo } from '../src/sidepanel/services/extensionBridge.js';
import { tabSessions } from '../src/sidepanel/services/tabSessionStore.js';
import { clearSessionToolPermissions } from '../src/sidepanel/services/toolPermissions.js';
import { WebMCPTool } from '../src/sidepanel/types/index.js';

const BOOK_TOOL: WebMCPTool = {
  name: 'book_table',
  description: 'Books a table.',
  inputSchema: '{"type":"object"}',
  frameId: 0,
};

interface SentMessage {
  tabId: number;
  message: { action?: string; name?: string; inputArgs?: unknown };
}

interface TestChrome {
  sent: SentMessage[];
  /** The tab in front, which the user can move while a turn is running. */
  activeTabId: number;
  restore: () => void;
}

/**
 * A browser with two tabs. Asking a tab for its tools answers the way a
 * content script would, by reporting a fresh list for that tab.
 */
function installTestChrome(): TestChrome {
  const original = globalThis.chrome;
  const state: TestChrome = {
    sent: [],
    activeTabId: 1,
    restore: () => {
      globalThis.chrome = original;
    },
  };

  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: state.activeTabId, url: `https://tab-${state.activeTabId}.example` }] as chrome.tabs.Tab[],
      get: async (tabId: number) => ({ id: tabId, url: `https://tab-${tabId}.example` } as chrome.tabs.Tab),
      sendMessage: async (tabId: number, message: SentMessage['message']) => {
        state.sent.push({ tabId, message });
        if (message.action === 'LIST_TOOLS') {
          // A report always replaces the list, which is how the wait for tools
          // to settle notices one arriving.
          tabSessions.update(tabId, { tools: [{ ...BOOK_TOOL }] });
          return { success: true };
        }
        return { booked: true, tabId };
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onActivated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    } as unknown as typeof chrome.tabs,
    runtime: {
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => {},
    } as unknown as typeof chrome.runtime,
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
    } as unknown as typeof chrome.webNavigation,
  } as typeof chrome;

  return state;
}

/** A response stream in the shape the backend server writes (NDJSON). */
function sseResponse(reply: {
  chatId?: string;
  text?: string;
  functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
  error?: string;
}): Response {
  const chunks: unknown[] = [];
  if (reply.error) {
    chunks.push({ error: reply.error });
  } else {
    if (reply.text) {
      chunks.push({ delta: reply.text });
    }
    chunks.push({
      done: true,
      chatId: reply.chatId,
      text: reply.text ?? '',
      functionCalls: (reply.functionCalls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index + 1}`,
        name: call.name,
        args: call.args ?? {},
      })),
    });
  }
  const body = `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
}

/**
 * Serves one scripted reply per chat turn, and remembers the requests so a
 * test can check which conversation each turn belonged to.
 */
function installBackend(replies: Array<Record<string, unknown>>): {
  requests: Array<Record<string, unknown>>;
  resets: Array<Record<string, unknown>>;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const resets: Array<Record<string, unknown>> = [];
  let turn = 0;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (String(url).endsWith('/api/chat/reset')) {
      resets.push(body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    requests.push(body);
    const reply = (replies[turn++] ?? { text: 'done', functionCalls: [] }) as {
      chatId?: string;
      text?: string;
      functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
      error?: string;
    };
    return sseResponse(reply);
  }) as unknown as typeof fetch;

  return { requests, resets, restore: () => { globalThis.fetch = originalFetch; } };
}

/**
 * The hook's return value for one tab. Rendering is enough to read the store
 * and to get hold of the handlers, which work on the store rather than on
 * anything the render owns.
 */
function readSession(tabId: number | null, options?: UseAgentSessionOptions): UseAgentSessionReturn {
  let captured: UseAgentSessionReturn | null = null;
  const Probe = () => {
    captured = useAgentSession(tabId, options);
    return null;
  };
  renderToString(React.createElement(Probe));
  assert.ok(captured, 'the probe should have rendered');
  return captured as unknown as UseAgentSessionReturn;
}

/**
 * Forgets every tab so each test starts clean. Chats end on the on-device path,
 * which keeps these resets out of the scripted backend's request log.
 */
function resetTabSessions(): void {
  for (const tabId of tabSessions.tabIds()) tabSessions.remove(tabId, { onDevice: true });
  clearSessionToolPermissions();
}

/** Waits until `condition` holds, or gives up so a test fails rather than hangs. */
async function waitFor(condition: () => boolean, message: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a permission prompt belongs to the tab that asked, and is not carried to another tab', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_book_table', args: { partySize: 2 } }] },
    { chatId: 'chat-tab-1', text: 'Booked.', functionCalls: [] },
  ]);

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1);
    tab1.setUserPrompt('Book a table');

    const turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingPermission !== null, 'tab 1 to ask for permission');

    // The user moves to another tab while tab 1 waits.
    browser.activeTabId = 2;
    const tab2 = readSession(2);

    // This is the bug: tab 2 used to show tab 1's prompt, over a page that
    // never asked for anything.
    assert.equal(tab2.pendingPermission, null);
    assert.deepEqual(tab2.messages, []);
    assert.equal(tab2.busy, false);
    // It is still clear that something, somewhere, is working.
    assert.equal(tab2.anyBusy, true);

    // Tab 1 still holds its own prompt and conversation.
    const waiting = readSession(1);
    assert.equal(waiting.pendingPermission?.toolName, 'book_table');
    assert.equal(waiting.busy, true);
    assert.deepEqual(waiting.messages.map((message) => message.text), ['Book a table']);

    waiting.pendingPermission?.allow();
    await turn;

    // The tool ran against the tab that asked, not the one in front.
    const executions = browser.sent.filter(({ message }) => message.action === 'EXECUTE_TOOL');
    assert.equal(executions.length, 1);
    assert.equal(executions[0].tabId, 1);

    // ...and so did the reply.
    const finished = readSession(1);
    assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai']);
    assert.equal(finished.messages[1].text, 'Booked.');
    assert.equal(finished.busy, false);
    assert.equal(finished.pendingPermission, null);

    assert.deepEqual(tabSessions.getState(2).messages, []);
    assert.equal(readSession(2).anyBusy, false);

    // Both turns belonged to the same conversation, which is tab 1's.
    assert.equal(backend.requests[1].chatId, 'chat-tab-1');
    assert.equal(backend.requests[0].message, 'Book a table');
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

test('each tab keeps its own conversation, composer and progress', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: 'Hello from tab one.', functionCalls: [] },
    { chatId: 'chat-tab-2', text: 'Hello from tab two.', functionCalls: [] },
  ]);

  try {
    const tab1 = readSession(1);
    tab1.setUserPrompt('Ask about tab one');
    await tab1.handleSendPrompt();

    browser.activeTabId = 2;
    const tab2 = readSession(2);
    // A composer that was never typed in is empty, rather than holding what
    // was typed somewhere else.
    assert.equal(tab2.userPrompt, '');
    tab2.setUserPrompt('Ask about tab two');
    await tab2.handleSendPrompt();

    assert.deepEqual(
      readSession(1).messages.map((message) => message.text),
      ['Ask about tab one', 'Hello from tab one.']
    );
    assert.deepEqual(
      readSession(2).messages.map((message) => message.text),
      ['Ask about tab two', 'Hello from tab two.']
    );

    // Each tab carries on its own isolated conversation with the backend.
    assert.deepEqual(
      backend.requests.map((request) => request.message),
      ['Ask about tab one', 'Ask about tab two']
    );
    assert.notEqual(backend.requests[0].chatId, backend.requests[1].chatId);

    // Starting over in one tab leaves the other alone.
    readSession(2).handleReset();
    assert.equal(readSession(2).messages.length, 0);
    assert.equal(readSession(1).messages.length, 2);
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

test('a turn keeps running in its own tab while the user works in another', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_book_table', args: {} }] },
    { chatId: 'chat-tab-1', text: 'All done.', functionCalls: [] },
  ]);

  try {
    // Each tab is on a different page, with tools of its own.
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    tabSessions.update(2, { tools: [{ name: 'unrelated_tool', frameId: 0 }] });

    const tab1 = readSession(1, { sensitiveActionAlerts: false });
    tab1.setUserPrompt('Book it');
    const turn = tab1.handleSendPrompt();

    browser.activeTabId = 2;
    await turn;

    // The tools declared on the second request are tab 1's, not those of the
    // page the user moved to.
    const declared = (backend.requests[1].tools as Array<{ name: string }>).map((tool) => tool.name);
    assert.deepEqual(declared, ['_0_book_table']);

    // Tools were listed for tab 1 as well, never for the tab in front.
    const listed = browser.sent.filter(({ message }) => message.action === 'LIST_TOOLS');
    assert.ok(listed.length > 0);
    assert.deepEqual([...new Set(listed.map(({ tabId }) => tabId))], [1]);

    assert.equal(readSession(1).messages.at(-1)?.text, 'All done.');
    assert.deepEqual(readSession(2).messages, []);
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

test('closing a tab stops its turn and forgets its conversation', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  // The reply never arrives, so the turn is still in flight when the tab goes.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { signal } = init;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  }) as unknown as typeof fetch;

  try {
    const tab1 = readSession(1);
    tab1.setUserPrompt('Something slow');
    const turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).busy, 'tab 1 to start working');

    tabSessions.remove(1);
    await turn;

    // Nothing is left behind for a tab that cannot be reached again.
    assert.equal(tabSessions.tabIds().includes(1), false);
    assert.deepEqual(tabSessions.getState(1).messages, []);
    assert.equal(tabSessions.isAnyBusy(), false);
  } finally {
    globalThis.fetch = originalFetch;
    browser.restore();
    resetTabSessions();
  }
});

test('a tool that opens its own tab moves the work there, not the conversation', async () => {
  resetTabSessions();
  const originalChrome = globalThis.chrome;
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_book_table', args: {} }] },
    { chatId: 'chat-tab-1', text: 'Confirmed on the new page.', functionCalls: [] },
  ]);

  const sent: SentMessage[] = [];
  let readyListener: ((message: unknown, sender: unknown) => void) | null = null;

  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 1, url: 'https://tab-1.example' }] as chrome.tabs.Tab[],
      get: async (tabId: number) => ({ id: tabId, status: 'complete' } as chrome.tabs.Tab),
      sendMessage: async (tabId: number, message: SentMessage['message']) => {
        sent.push({ tabId, message });
        if (message.action === 'EXECUTE_TOOL') {
          // The tool submitted a form into a new tab, which closes the channel.
          setTimeout(() => {
            readyListener?.({ type: 'contentScriptReady' }, { tab: { id: 7, openerTabId: 1 } });
            // The page that opened reports the tools it has.
            tabSessions.update(7, { tools: [{ name: 'confirm_booking', frameId: 0 }] });
            readyListener?.({ tools: [] }, { tab: { id: 7 } });
          }, 5);
          throw new Error('message channel is closed');
        }
        if (message.action === 'LIST_TOOLS') {
          tabSessions.update(tabId, { tools: [{ name: 'confirm_booking', frameId: 0 }] });
          return { success: true };
        }
        return { confirmed: true };
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    } as unknown as typeof chrome.tabs,
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown, sender: unknown) => void) => {
          readyListener = listener;
        },
        removeListener: () => {
          readyListener = null;
        },
      },
    } as unknown as typeof chrome.runtime,
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
    } as unknown as typeof chrome.webNavigation,
  } as typeof chrome;

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, { sensitiveActionAlerts: false });
    tab1.setUserPrompt('Book it');
    await tab1.handleSendPrompt();

    // The result was collected from the tab the tool opened...
    const collected = sent.find(({ message }) => message.action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT');
    assert.equal(collected?.tabId, 7);
    // ...and the turn went on with that page's tools.
    const declared = (backend.requests[1].tools as Array<{ name: string }>).map((tool) => tool.name);
    assert.deepEqual(declared, ['_0_confirm_booking']);

    // The conversation stayed where the user started it.
    assert.equal(readSession(1).messages.at(-1)?.text, 'Confirmed on the new page.');
    assert.deepEqual(tabSessions.getState(7).messages, []);
  } finally {
    resetTabSessions();
    backend.restore();
    globalThis.chrome = originalChrome;
  }
});

test('the store tells React only when a tab actually changed', () => {
  resetTabSessions();
  let notifications = 0;
  const unsubscribe = tabSessions.subscribe(() => {
    notifications++;
  });

  try {
    tabSessions.update(1, { statusMsg: 'Loading' });
    assert.equal(notifications, 1);

    // Pages report the same tool list on a timer; re-rendering the panel for
    // every unchanged report would be waste.
    tabSessions.update(1, { statusMsg: 'Loading' });
    assert.equal(notifications, 1);

    tabSessions.update(1, { statusMsg: 'Ready' });
    assert.equal(notifications, 2);

    // An unknown tab reads as empty rather than throwing, and reads the same
    // object every time, which is what useSyncExternalStore compares.
    assert.equal(tabSessions.getState(99), tabSessions.getState(99));
    assert.equal(tabSessions.getState(null).pendingPermission, null);
  } finally {
    unsubscribe();
    resetTabSessions();
  }
});

test('the extension bridge talks to the tab it is given, not the one in front', async () => {
  const browser = installTestChrome();
  try {
    browser.activeTabId = 2;

    await requestTabTools(1);
    assert.equal(browser.sent.at(-1)?.tabId, 1);

    await executeTabTool('book_table', { partySize: 2 }, 0, 1);
    assert.equal(browser.sent.at(-1)?.tabId, 1);

  } finally {
    browser.restore();
    resetTabSessions();
  }
});

test('denying a permission prompt sends refusal response and does not execute tool', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_book_table', args: { partySize: 2 } }] },
    { chatId: 'chat-tab-1', text: 'Understood, cancelled.', functionCalls: [] },
  ]);

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1);
    tab1.setUserPrompt('Book a table');

    const turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingPermission !== null, 'tab 1 to ask for permission');

    // Deny permission
    tabSessions.getState(1).pendingPermission?.deny();
    await turn;

    // Verify tool was NOT executed
    const executions = browser.sent.filter(({ message }) => message.action === 'EXECUTE_TOOL');
    assert.equal(executions.length, 0);

    // Verify backend received the refusal in toolResponses
    const secondTurnRequest = backend.requests[1];
    assert.ok(secondTurnRequest);
    const toolResponses = secondTurnRequest.toolResponses as Array<{
      functionResponse: { name: string; response: { error?: string } };
    }>;
    assert.equal(toolResponses.length, 1);
    assert.equal(toolResponses[0].functionResponse.name, '_0_book_table');
    assert.equal(toolResponses[0].functionResponse.response.error, 'User denied permission to execute this tool.');

    const finished = readSession(1);
    assert.equal(finished.messages.at(-1)?.text, 'Understood, cancelled.');
    assert.equal(finished.busy, false);
    assert.equal(finished.pendingPermission, null);
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

test('on-device model rejects concurrent turns across different tabs', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  // Simulate an on-device turn in flight for tab 1
  tabSessions.update(1, { busy: true });

  try {
    const tab2 = readSession(2, { onDeviceModel: true });
    tab2.setUserPrompt('Hello from tab 2');
    await tab2.handleSendPrompt();

    const state2 = tabSessions.getState(2);
    assert.equal(state2.messages.length, 1);
    assert.equal(state2.messages[0].role, 'error');
    assert.ok(state2.messages[0].text.includes('The on-device model can only answer one tab at a time'));
  } finally {
    browser.restore();
    resetTabSessions();
  }
});

test('handleStop preserves streaming text and resets busy and permission on the active tab', () => {
  resetTabSessions();
  const browser = installTestChrome();

  try {
    tabSessions.update(1, {
      busy: true,
      streamingText: 'Here is what I found so far...',
      pendingPermission: {
        toolName: 'book_table',
        allow: () => {},
        deny: () => {},
      },
    });

    const tab1 = readSession(1);
    tab1.handleStop();

    const state1 = tabSessions.getState(1);
    assert.equal(state1.busy, false);
    assert.equal(state1.pendingPermission, null);
    assert.equal(state1.streamingText, '');
    assert.equal(state1.messages.length, 1);
    assert.equal(state1.messages[0].role, 'ai');
    assert.equal(state1.messages[0].text, 'Here is what I found so far...');
  } finally {
    browser.restore();
    resetTabSessions();
  }
});

test('getTabInfo returns tab metadata when tab exists and null when tabs.get throws', async () => {
  const browser = installTestChrome();
  try {
    const info = await getTabInfo(1);
    assert.ok(info);
    assert.equal(info.tabId, 1);
    assert.equal(info.domain, 'tab-1.example');

    // When tab does not exist or has closed
    const origGet = globalThis.chrome.tabs.get;
    globalThis.chrome.tabs.get = (async () => {
      throw new Error('Tab not found');
    }) as unknown as typeof chrome.tabs.get;

    const missing = await getTabInfo(999);
    assert.equal(missing, null);
    globalThis.chrome.tabs.get = origGet;
  } finally {
    browser.restore();
  }
});

test('tabSessions.remove resets backend chat session when chatId is present', async () => {
  resetTabSessions();
  const backend = installBackend([{ chatId: 'chat-tab-42', text: 'First reply', functionCalls: [] }]);

  try {
    const tab42 = readSession(42);
    tab42.setUserPrompt('Initial message');
    await tab42.handleSendPrompt();
    assert.equal(tabSessions.getInternals(42).chatId, 'chat-tab-42');
    assert.equal(tabSessions.tabIds().includes(42), true);

    tabSessions.remove(42);
    assert.equal(tabSessions.tabIds().includes(42), false);
    assert.deepEqual(backend.resets, [{ chatId: 'chat-tab-42' }]);
  } finally {
    resetTabSessions();
    backend.restore();
  }
});

function runHook<T>(useHook: () => T): { result: { current: T }; cleanup: () => void } {
  const effects: Array<() => void | (() => void)> = [];
  const result = {} as { current: T };
  const HookRunner = () => {
    const disp = (React as unknown as { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: { current: unknown } } })
      .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
    const realDispatcher = disp.current as Record<string, unknown>;
    disp.current = new Proxy(realDispatcher, {
      get(target, prop) {
        if (prop === 'useEffect') {
          return (fn: () => void | (() => void)) => {
            effects.push(fn);
          };
        }
        return target[prop as string];
      },
    });
    result.current = useHook();
    disp.current = realDispatcher;
    return null;
  };
  renderToString(React.createElement(HookRunner));
  const cleanups: Array<() => void> = [];
  for (const eff of effects) {
    const clean = eff();
    if (typeof clean === 'function') cleanups.push(clean);
  }
  return {
    result,
    cleanup: () => {
      for (const clean of cleanups) clean();
    },
  };
}

test('useActiveTabTools preserves tools on status messages and ignores action messages', () => {
  resetTabSessions();
  const listeners: Array<(message: unknown, sender?: unknown) => void> = [];
  const origChrome = globalThis.chrome;
  const origWindow = globalThis.window;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (cb: (message: unknown, sender?: unknown) => void) => listeners.push(cb),
        removeListener: (cb: (message: unknown, sender?: unknown) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
        },
      },
    },
    tabs: {
      get: async () => ({ id: 1, url: 'https://example.com' } as chrome.tabs.Tab),
      sendMessage: async () => ({ success: true }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
  } as unknown as typeof chrome;

  globalThis.window = {
    chrome: globalThis.chrome,
  } as unknown as Window & typeof globalThis;

  try {
    const { cleanup } = runHook(() => useActiveTabTools(1));
    assert.equal(listeners.length, 1);
    const listener = listeners[0];

    // 1. A report with tools arrives for tab 1
    listener({ tools: [BOOK_TOOL], url: 'https://example.com' }, { tab: { id: 1 } });
    assert.deepEqual(tabSessions.getState(1).tools, [BOOK_TOOL]);

    // 2. An internal frame message with action arrives: it should be ignored and NOT wipe tools
    listener({ action: 'INJECT_GET_FRAME_ID' }, { tab: { id: 1 }, frameId: 0 });
    assert.deepEqual(tabSessions.getState(1).tools, [BOOK_TOOL]);

    listener({ action: 'GET_FRAME_ID' }, { tab: { id: 1 }, frameId: 0 });
    assert.deepEqual(tabSessions.getState(1).tools, [BOOK_TOOL]);

    // 3. A status/error message from a tab's content script preserves previous tools
    listener({ message: 'Could not connect' }, { tab: { id: 1 } });
    assert.deepEqual(tabSessions.getState(1).tools, [BOOK_TOOL]);
    assert.equal(tabSessions.getState(1).statusMsg, 'Could not connect');

    // 3b. A service-worker error message without sender.tab is ignored
    listener({ message: 'Could not establish connection. Receiving end does not exist.' }, {});
    assert.equal(tabSessions.getState(1).statusMsg, 'Could not connect');

    // 4. When a fresh tools report subsequently arrives, it clears the statusMsg error
    listener({ tools: [BOOK_TOOL], url: 'https://example.com' }, { tab: { id: 1 } });
    assert.deepEqual(tabSessions.getState(1).tools, [BOOK_TOOL]);
    assert.equal(tabSessions.getState(1).statusMsg, '');

    cleanup();
    assert.equal(listeners.length, 0);
  } finally {
    globalThis.chrome = origChrome;
    globalThis.window = origWindow;
    resetTabSessions();
  }
});

test('useActiveTabId cleans up removedTabId on chrome.tabs.onReplaced', async () => {
  resetTabSessions();
  let replacedListener: ((addedTabId: number, removedTabId: number) => void) | null = null;
  const origChrome = globalThis.chrome;
  const origWindow = globalThis.window;

  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 2, url: 'https://example.com' } as chrome.tabs.Tab],
      onActivated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onReplaced: {
        addListener: (cb: (addedTabId: number, removedTabId: number) => void) => {
          replacedListener = cb;
        },
        removeListener: () => {
          replacedListener = null;
        },
      },
    },
    windows: {
      onFocusChanged: { addListener: () => {}, removeListener: () => {} },
    },
  } as unknown as typeof chrome;

  globalThis.window = {
    chrome: globalThis.chrome,
  } as unknown as Window & typeof globalThis;

  try {
    // Populate session state for tab 1 (the tab that will be replaced)
    tabSessions.update(1, { messages: [{ id: 1, role: 'user', text: 'hello' }] });
    assert.equal(tabSessions.tabIds().includes(1), true);

    const { cleanup } = runHook(() => useActiveTabId());
    const onReplacedCb = replacedListener as ((addedTabId: number, removedTabId: number) => void) | null;
    assert.ok(onReplacedCb);

    // Prerendered tab swap: tab 1 is replaced by tab 2
    onReplacedCb(2, 1);

    // tab 1 should be completely removed from tabSessions
    assert.equal(tabSessions.tabIds().includes(1), false);

    cleanup();
    assert.equal(replacedListener, null);
  } finally {
    globalThis.chrome = origChrome;
    globalThis.window = origWindow;
    resetTabSessions();
  }
});

test('useAgentSession logs raw errors to console and displays a generic error message in chat', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];

  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  globalThis.fetch = (async () =>
    sseResponse({
      error:
        '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
    })) as unknown as typeof fetch;

  try {
    const tab1 = readSession(1);
    tab1.setUserPrompt('open first door');
    await tab1.handleSendPrompt();

    const state1 = tabSessions.getState(1);
    assert.equal(state1.messages.length, 2);
    assert.equal(state1.messages[1].role, 'error');
    assert.equal(
      state1.messages[1].text,
      'Something went wrong while processing your request. Please try again.'
    );
    assert.ok(!state1.messages[1].text.includes('high demand'));
    assert.ok(loggedErrors.length > 0);
    assert.ok(String(loggedErrors[0][1]).includes('This model is currently experiencing high demand.'));
  } finally {
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
    browser.restore();
    resetTabSessions();
  }
});

test('a call to a tool the page does not expose is rejected immediately without prompting or executing', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_nonexistent_tool', args: {} }] },
    { chatId: 'chat-tab-1', text: 'That tool is unavailable.', functionCalls: [] },
  ]);

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, { sensitiveActionAlerts: true });
    tab1.setUserPrompt('Run unknown tool');
    await tab1.handleSendPrompt();

    // No permission prompt was shown and EXECUTE_TOOL was never sent to the page.
    assert.equal(tabSessions.getState(1).pendingPermission, null);
    const executions = browser.sent.filter(({ message }) => message.action === 'EXECUTE_TOOL');
    assert.equal(executions.length, 0);

    // The model was told the tool is not available on this page.
    const secondTurnRequest = backend.requests[1];
    assert.ok(secondTurnRequest);
    const toolResponses = secondTurnRequest.toolResponses as Array<{
      functionResponse: { name: string; response: { error?: string } };
    }>;
    assert.equal(toolResponses.length, 1);
    assert.equal(toolResponses[0].functionResponse.name, '_0_nonexistent_tool');
    assert.equal(
      toolResponses[0].functionResponse.response.error,
      'Tool "nonexistent_tool" is not available on this page.'
    );
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});
