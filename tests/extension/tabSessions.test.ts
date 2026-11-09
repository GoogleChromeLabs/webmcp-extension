/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';

import { useAgentSession, type UseAgentSessionOptions, type UseAgentSessionReturn } from '../../extension/sidepanel/hooks/useAgentSession.js';
import { useActiveTabTools } from '../../extension/sidepanel/hooks/useActiveTabTools.js';
import { useActiveTabId } from '../../extension/sidepanel/hooks/useActiveTabId.js';
import { requestTabTools, executeTabTool, getTabInfo } from '../../extension/sidepanel/services/extensionBridge.js';
import { resetOnDeviceChat } from '../../extension/sidepanel/services/promptApiBackend.js';
import { tabSessions } from '../../extension/sidepanel/services/tabSessionStore.js';
import { clearSessionToolPermissions } from '../../extension/sidepanel/services/toolPermissions.js';
import { DEFAULT_TOOL_ROUND_LIMITS, ToolRoundLimitError } from '../../extension/sidepanel/services/toolRoundLimits.js';
import { type ChatTurnRequest, type WebMCPTool } from '../../extension/sidepanel/types/index.js';

const BOOK_TOOL: WebMCPTool = {
  name: 'book_table',
  description: 'Books a table.',
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
  if (reply.text) {
    chunks.push({ delta: reply.text });
  }
  if (reply.error) {
    chunks.push({ error: reply.error });
  } else {
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
function installBackend(replies: Array<Record<string, unknown> | (() => Response | Promise<Response>)>): {
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
    const nextReply = replies[turn++] ?? { text: 'done', functionCalls: [] };
    if (typeof nextReply === 'function') return nextReply();
    const reply = nextReply as {
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

test('denying a permission prompt refuses the call and counts zero attempts at checkpoint Stop', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([asksForTable(1), asksForTable(2), { text: '' }]);
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, { toolRoundLimits: { askAfter: 1, max: 3 } });
    tab1.setUserPrompt('Book a table');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingPermission !== null, 'permission');
    tabSessions.getState(1).pendingPermission!.deny();
    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the checkpoint');
    tabSessions.getState(1).pendingCheckpoint!.deny();
    await turn;

    const refusal = (backend.requests[1] as ChatTurnRequest).toolResponses!;
    assert.equal(refusal.length, 1);
    assert.equal(refusal[0].functionResponse.name, '_0_book_table');
    assert.equal(refusal[0].functionResponse.response.error, 'User denied permission to execute this tool.');
    const summary = backend.requests[2] as ChatTurnRequest;
    assert.match(summary.toolResponses![0].functionResponse.response.error!, /Tool calls attempted: 0\. Tool rounds used: 1\./);
    const finished = readSession(1);
    assert.equal(finished.messages.at(-1)?.text, 'Stopped after attempting 0 tool calls.');
    assert.equal(finished.activityLog.length, 1, 'a completed refusal entry is not an attempted dispatch');
    assert.ok(finished.activityLog[0].done);
    assert.deepEqual(finished.messages.at(-1)?.activityLogs, finished.activityLog);
    assert.equal(finished.busy, false);
    assert.equal(finished.pendingPermission, null);
    assert.equal(finished.pendingCheckpoint, null);
    assert.equal(executionsIn(browser).length, 0);
    assert.equal(backend.requests.length, 3);
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
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

    // An empty Stop dismisses the checkpoint without adding another reply.
    tabSessions.update(1, {
      busy: true, streamingText: '  ',
      pendingCheckpoint: { roundsUsed: 1, maxRounds: 3, allow: () => {}, deny: () => {} },
    });
    tab1.handleStop();
    tab1.handleStop();
    assert.deepEqual(readSession(1).messages, state1.messages);
    assert.equal(readSession(1).pendingCheckpoint, null);
    assert.equal(readSession(1).streamingText, '');
    assert.equal(readSession(1).busy, false);
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

function withAct(fn: () => void): void {
  const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; window?: unknown };
  const prevActEnv = globals.IS_REACT_ACT_ENVIRONMENT;
  const hadWindow = 'window' in globals && globals.window !== undefined;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  if (!hadWindow) globals.window = {};
  try {
    act(fn);
  } finally {
    globals.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    if (!hadWindow) delete globals.window;
  }
}

function runHook<T>(useHook: () => T): { result: { current: T }; cleanup: () => void } {
  const { document } = parseHTML('<!doctype html><html><body><div></div></body></html>');
  const container = document.querySelector('div') as unknown as Element;
  const root = createRoot(container);
  const result = {} as { current: T };
  const HookRunner = () => {
    result.current = useHook();
    return null;
  };
  withAct(() => {
    root.render(React.createElement(HookRunner));
  });
  return {
    result,
    cleanup: () => {
      withAct(() => {
        root.unmount();
      });
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

/** The tool runs the page was asked for, in order. */
function executionsIn(browser: TestChrome): SentMessage[] {
  return browser.sent.filter(({ message }) => message.action === 'EXECUTE_TOOL');
}

/** A reply in which the model asks to book one more table. */
function asksForTable(round: number, text = ''): Record<string, unknown> {
  return {
    chatId: 'chat-tab-1',
    text,
    functionCalls: [{ id: `call_${round}`, name: '_0_book_table', args: { partySize: round } }],
  };
}

test('the agent asks once whether to keep going, then stops at the limit and says so', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([asksForTable(1), asksForTable(2, 'One booked.'), asksForTable(3), asksForTable(4)]);
  let timesAsked = 0;
  let asking = false;
  const unsubscribe = tabSessions.subscribe(() => {
    const now = tabSessions.getState(1).pendingCheckpoint !== null;
    if (now && !asking) timesAsked++;
    asking = now;
  });

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    // 10 and 100 in miniature, with no permission prompts in the way.
    const tab1 = readSession(1, {
      sensitiveActionAlerts: false,
      toolRoundLimits: { askAfter: 1, max: 3 },
    });
    tab1.setUserPrompt('Book four tables');
    const turn = tab1.handleSendPrompt();

    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
    const checkpoint = tabSessions.getState(1).pendingCheckpoint!;
    assert.deepEqual([checkpoint.roundsUsed, checkpoint.maxRounds], [1, 3]);
    // Nothing more runs while it waits.
    assert.equal(executionsIn(browser).length, 1);
    checkpoint.allow();
    await turn;

    // Asked once. Three rounds ran, and the fourth was neither run nor sent.
    assert.equal(timesAsked, 1);
    assert.equal(executionsIn(browser).length, 3);
    assert.equal(backend.requests.length, 4);

    const finished = readSession(1);
    assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai', 'ai', 'error']);
    assert.equal(finished.messages[1].text, 'One booked.');
    assert.equal(finished.messages[2].text, '');
    const [newest, middle, oldest] = finished.activityLog;
    assert.equal(finished.activityLog.length, 3);
    assert.ok(finished.activityLog.every((entry) => entry.done));
    assert.deepEqual(finished.messages.slice(1, 3).map((message) => message.activityLogs), [[oldest], [newest, middle]],
      'activity after earlier text stays in a later message, exactly once');
    assert.equal(
      finished.messages[3].text,
      'The agent stopped after using tools 3 times, the most allowed for one request. Try asking again, or split the task into smaller steps.'
    );
    assert.equal(finished.pendingCheckpoint, null);
    assert.equal(finished.busy, false);
  } finally {
    unsubscribe();
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

test('checkpoint Stop summarizes completed and failed attempts, refuses pending calls, and keeps the conversation', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const summary = 'One table booked. Another booking failed; two tables remain.';
  const pendingCalls = [3, 4].map((id) => ({ id: `call_${id}`, name: '_0_book_table', args: {} }));
  const backend = installBackend([
    { ...asksForTable(1), functionCalls: [1, 2].map((id) => ({ id: `call_${id}`, name: '_0_book_table', args: { partySize: id } })) },
    { chatId: 'chat-tab-1', text: 'One booking succeeded; another failed.', functionCalls: pendingCalls },
    { chatId: 'chat-tab-1', text: summary },
    { chatId: 'chat-tab-1', text: 'Two tables remain.' },
  ]);
  const sendMessage = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (async (tabId: number, message: SentMessage['message']) => {
    const result = await sendMessage(tabId, message);
    if (message.action === 'EXECUTE_TOOL' && (message.inputArgs as { partySize: number }).partySize === 2) {
      throw new Error('Booking failed');
    }
    return result;
  }) as typeof chrome.tabs.sendMessage;
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, { sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } });
    tab1.setUserPrompt('Book tables');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the checkpoint');
    assert.equal(readSession(1).messages.at(-1)?.text, 'One booking succeeded; another failed.');
    tabSessions.getState(1).pendingCheckpoint!.deny();
    await turn;

    const outcomes = (backend.requests[1] as ChatTurnRequest).toolResponses!;
    assert.ok(outcomes[0].functionResponse.response.result);
    assert.equal(outcomes[1].functionResponse.response.error, 'Booking failed');
    const request = backend.requests[2] as ChatTurnRequest;
    assert.deepEqual(request.toolResponses?.map(({ functionResponse }) => [functionResponse.id, functionResponse.name]),
      pendingCalls.map((call) => [call.id, call.name]));
    for (const { functionResponse } of request.toolResponses!) {
      assert.match(functionResponse.response.error!, /^Not run: the user stopped the agent here/);
      assert.match(functionResponse.response.error!, /Do not call any more tools/);
      assert.match(functionResponse.response.error!, /summary of what you completed and what remains/);
      assert.match(functionResponse.response.error!, /Tool calls attempted: 2\. Tool rounds used: 1\./);
      assert.match(functionResponse.response.error!, /based on the tool results/);
      assert.equal(functionResponse.response.result, undefined);
    }
    const finished = readSession(1);
    assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai', 'ai']);
    assert.equal(finished.messages[2].text, summary);
    assert.equal(finished.activityLog.length, 2);
    assert.ok(finished.activityLog.every((entry) => entry.done));
    assert.deepEqual(finished.messages[1].activityLogs, finished.activityLog);
    assert.deepEqual(finished.messages[2].activityLogs, []);
    assert.equal(finished.busy, false);
    assert.equal(finished.pendingCheckpoint, null);
    assert.equal(executionsIn(browser).length, 2);
    assert.equal(backend.requests.length, 3, 'only one summary request; pending calls never run');
    assert.deepEqual(backend.resets, []);
    tab1.setUserPrompt('What remains?');
    await tab1.handleSendPrompt();
    assert.equal(backend.requests[3].chatId, request.chatId);
    assert.deepEqual(readSession(1).messages.slice(0, finished.messages.length), finished.messages);
    assert.equal(readSession(1).messages.at(-1)?.text, 'Two tables remain.');
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
    backend.restore();
    browser.restore();
  }
});

// Each unusable summary must produce a normal note, not a generic error or another tool round.
for (const { name, reply } of [
  { name: 'an error after partial text', reply: { text: 'Incomplete summary.', error: 'Summary failed' } },
  { name: 'whitespace only', reply: { text: '   ' } },
  { name: 'further tools with text', reply: asksForTable(4, 'I will keep booking.') },
]) {
  test(`checkpoint summary falls back on ${name}`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const backend = installBackend([
      { ...asksForTable(1), functionCalls: [1, 2].map((id) => ({ id: `c${id}`, name: '_0_book_table', args: {} })) },
      asksForTable(3), reply,
    ]);
    let turn: Promise<void> | undefined;
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, { sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } });
      tab1.setUserPrompt('Book tables');
      turn = tab1.handleSendPrompt();
      await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the checkpoint');
      tabSessions.getState(1).pendingCheckpoint!.deny();
      await turn;
      const stopped = readSession(1);
      assert.deepEqual(stopped.messages.map((message) => [message.role, message.text]),
        [['user', 'Book tables'], ['ai', 'Stopped after attempting 2 tool calls.']]);
      assert.deepEqual(stopped.messages[1].activityLogs, stopped.activityLog);
      assert.equal(stopped.activityLog.length, 2);
      assert.ok(stopped.activityLog.every((entry) => entry.done));
      assert.equal(stopped.busy, false);
      assert.equal(stopped.streamingText, '');
      assert.equal(executionsIn(browser).length, 2);
      assert.equal(backend.requests.length, 3, 'no retries, further tools, or summary rounds');
      assert.deepEqual(backend.resets, []);
    } finally {
      resetTabSessions();
      await Promise.allSettled([turn]);
      backend.restore();
      browser.restore();
    }
  });
}

// Stop remains immediate during the new summary wait; late output cannot overwrite a new turn.
for (const cancellation of ['toolbar', 'reset'] as const) {
  test(`${cancellation} cancels a streaming checkpoint summary and ignores late output`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    const nextReply = Promise.withResolvers<Response>();
    const backend = installBackend([asksForTable(1), asksForTable(2), () => response, () => nextReply.promise]);
    const encoder = new TextEncoder();
    let turn: Promise<void> | undefined;
    let nextTurn: Promise<void> | undefined;
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, { sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } });
      tab1.setUserPrompt('Book tables');
      turn = tab1.handleSendPrompt();
      await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the checkpoint');
      tabSessions.getState(1).pendingCheckpoint!.deny();
      await waitFor(() => backend.requests.length === 3, 'the summary');
      assert.equal(readSession(1).busy, true);
      stream.enqueue(encoder.encode(`${JSON.stringify({ delta: 'One table booked.' })}\n`));
      await waitFor(() => readSession(1).streamingText === 'One table booked.', 'partial summary');
      if (cancellation === 'toolbar') tab1.handleStop();
      else tab1.handleReset();
      const cancelled = readSession(1);
      assert.equal(cancelled.busy, false, 'cancellation is immediate');
      assert.equal(cancelled.streamingText, '');
      assert.equal(cancelled.pendingCheckpoint, null);
      if (cancellation === 'toolbar') {
        assert.equal(cancelled.messages.at(-1)?.text, 'One table booked.');
        assert.equal(cancelled.messages.at(-1)?.activityLogs?.length, 1);
        assert.ok(cancelled.messages.at(-1)?.activityLogs?.[0].done);
        assert.deepEqual(backend.resets, []);
      } else assert.deepEqual(cancelled.messages, []);

      tab1.setUserPrompt('Next question');
      nextTurn = tab1.handleSendPrompt();
      await waitFor(() => backend.requests.length === 4, 'the next request');
      const messages = readSession(1).messages;
      stream.enqueue(encoder.encode(`${JSON.stringify({ done: true, text: 'Late summary.', functionCalls: [{ name: '_0_book_table' }] })}\n`));
      stream.close();
      await turn;
      assert.deepEqual(readSession(1).messages, messages, 'no late summary or fallback');
      assert.equal(readSession(1).busy, true, 'the new turn is still waiting');
      assert.equal(executionsIn(browser).length, 1);
      assert.equal(backend.requests.length, 4);
      assert.deepEqual(messages.slice(0, cancelled.messages.length), cancelled.messages);
      // A late finalizer must not detach cancellation from the new request.
      tab1.handleStop();
      assert.equal(readSession(1).busy, false);
      nextReply.resolve(sseResponse({ text: 'New answer.' }));
      await nextTurn;
      assert.deepEqual(readSession(1).messages, messages, 'the new request still honors Stop');
    } finally {
      resetTabSessions();
      stream.error(new DOMException('Test cleanup', 'AbortError'));
      nextReply.resolve(sseResponse({ text: '' }));
      await Promise.allSettled([turn, nextTurn]);
      backend.restore();
      browser.restore();
    }
  });
}

/** One reply of the on-device model: what it says, and the tools it calls. */
type ModelReply = Array<
  string | { type: 'tool-call'; value: { callID: string; name: string; arguments: Record<string, unknown> } }
>;

/**
 * Just enough of the browser's Prompt API for the on-device backend: every
 * prompt streams the next reply of `script`.
 */
function installOnDeviceModel(script: Array<ModelReply | Error>, failOnCreate?: number): {
  creates: Array<{ initialPrompts: unknown[] }>;
  inputs: unknown[];
  restore: () => void;
} {
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ['LanguageModel', 'LanguageModelToolCall', 'LanguageModelToolSuccess', 'LanguageModelToolError'];
  const creates: Array<{ initialPrompts: unknown[] }> = [];
  const inputs: unknown[] = [];
  class ToolPart {
    constructor(init: object) {
      Object.assign(this, init);
    }
  }
  let turn = 0;
  Object.assign(globals, {
    LanguageModelToolCall: ToolPart,
    LanguageModelToolSuccess: ToolPart,
    LanguageModelToolError: ToolPart,
    LanguageModel: {
      availability: async () => 'available',
      create: async (options: { initialPrompts?: unknown[] }) => {
        creates.push({ initialPrompts: [...(options.initialPrompts ?? [])] });
        if (creates.length === failOnCreate) throw new Error('Session creation failed');
        return Object.assign(new EventTarget(), {
          contextUsage: 0,
          contextWindow: 1000,
          destroy: () => {},
          promptStreaming: (input: unknown) => {
            inputs.push(input);
            return new ReadableStream({
              start(controller) {
                const reply = script[turn++] ?? [''];
                if (reply instanceof Error) {
                  controller.error(reply);
                  return;
                }
                for (const chunk of reply) controller.enqueue(chunk);
                controller.close();
              },
            });
          },
        });
      },
    },
  });
  return {
    creates,
    inputs,
    restore: () => {
      resetOnDeviceChat();
      for (const name of names) delete globals[name];
    },
  };
}

test('an on-device checkpoint summary survives a subsequent message and session replay', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const summary = 'One table booked. Another table remains.';
  const model = installOnDeviceModel([
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: { partySize: 1 } } }],
    [{ type: 'tool-call', value: { callID: 'c2', name: '_0_book_table', arguments: { partySize: 2 } } }],
    [summary],
    ['Another table remains.'],
    ['Hello from tab two.'],
    ['Next answer.'],
  ]);
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const options = { onDeviceModel: true, sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } };
    const tab1 = readSession(1, options);
    tab1.setUserPrompt('Book two tables');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the checkpoint');
    tabSessions.getState(1).pendingCheckpoint!.deny();
    await turn;
    assert.equal(readSession(1, options).messages.at(-1)?.text, summary);
    assert.equal(model.inputs.length, 3, 'one summary request');
    tab1.setUserPrompt('What remains?');
    await tab1.handleSendPrompt();
    assert.equal(model.creates.length, 1, 'the completed summary leaves a reusable session');

    const tab2 = readSession(2, options);
    tab2.setUserPrompt('Hello');
    await tab2.handleSendPrompt();
    tab1.setUserPrompt('Continue');
    await tab1.handleSendPrompt();
    const replayed = model.creates.at(-1)!.initialPrompts as Array<{ role: string; content: unknown }>;
    assert.ok(replayed.some((message) => message.role === 'user' && message.content === 'Book two tables'));
    assert.ok(replayed.some((message) => message.role === 'assistant' && message.content === summary),
      'the summary is available to the model, not just displayed in the UI');
    assert.ok(replayed.some((message) => message.role === 'assistant' && message.content === 'Another table remains.'));
    assert.equal(executionsIn(browser).length, 1);
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
    model.restore();
    browser.restore();
  }
});

// The wrapper normally refuses repeated calls internally and prompts again; summaries must stop sooner.
test('on-device checkpoint summary falls back after repeated call without running more tools', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const call = (id: string, partySize: number): ModelReply => [
    { type: 'tool-call', value: { callID: id, name: '_0_book_table', arguments: { partySize } } },
  ];
  const model = installOnDeviceModel([
    call('c1', 1),
    call('c2', 2),
    call('c3', 1),
    ['A new answer.'],
  ]);
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const options = { onDeviceModel: true, sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } };
    const tab1 = readSession(1, options);
    tab1.setUserPrompt('Book two tables');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
    tabSessions.getState(1).pendingCheckpoint!.deny();
    await turn;

    const stopped = readSession(1, options);
    assert.equal(stopped.messages.at(-1)?.text, 'Stopped after attempting 1 tool call.');
    assert.deepEqual(stopped.messages.at(-1)?.activityLogs, stopped.activityLog);
    assert.equal(stopped.activityLog.length, 1);
    assert.equal(stopped.busy, false);
    assert.equal(model.inputs.length, 3, 'fallback stops at the first additional tool request');

    tab1.setUserPrompt('A new question');
    await tab1.handleSendPrompt();
    assert.equal(readSession(1, options).messages.at(-1)?.text, 'A new answer.');
    assert.deepEqual(readSession(1, options).messages.slice(0, stopped.messages.length), stopped.messages);
    assert.equal(executionsIn(browser).length, 1, 'stopped calls are never executed');
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
    model.restore();
    browser.restore();
  }
});

// Failed replacements must preserve earlier turns without recovering unanswered calls from the stopped turn.
for (const replacement of ['context retry', 'changed tools', 'changed tools then context retry'] as const) {
  test(`a checkpoint summary ${replacement} creation failure preserves previously completed history`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const contextRetry = replacement !== 'changed tools';
    const changedTools = replacement !== 'context retry';
    const failedCreation = contextRetry && changedTools ? 3 : 2;
    const model = installOnDeviceModel([
      ['A previous answer.'],
      [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: { partySize: 1 } } }],
      [{ type: 'tool-call', value: { callID: 'c2', name: '_0_book_table', arguments: { partySize: 2 } } }],
      ...(contextRetry ? [new DOMException('Context full', 'QuotaExceededError')] : []),
      ['Answer to the new message.'],
    ], failedCreation);
    let turn: Promise<void> | undefined;
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const options = { onDeviceModel: true, sensitiveActionAlerts: false, toolRoundLimits: { askAfter: 1, max: 3 } };
      const tab1 = readSession(1, options);
      tab1.setUserPrompt('An earlier question');
      await tab1.handleSendPrompt();
      tab1.setUserPrompt('Book two tables');
      turn = tab1.handleSendPrompt();
      await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
      if (changedTools) {
        tabSessions.update(1, { tools: [{ ...BOOK_TOOL, description: 'Updated booking tool.' }] });
      }
      tabSessions.getState(1).pendingCheckpoint!.deny();
      await turn;
      assert.equal(readSession(1, options).messages.at(-1)?.text, 'Stopped after attempting 1 tool call.');
      assert.equal(model.creates.length, failedCreation, 'replacement session creation failed');

      tab1.setUserPrompt('What was my earlier question?');
      await tab1.handleSendPrompt();
      const replayed = model.creates.at(-1)!.initialPrompts as Array<{ role: string; content: unknown }>;
      assert.deepEqual(replayed.filter((message) => message.role !== 'system'), [
        { role: 'user', content: 'An earlier question' },
        { role: 'assistant', content: 'A previous answer.' },
      ], 'recovery keeps earlier completed turns without any stopped-turn calls or responses');
      assert.equal(readSession(1, options).messages.at(-1)?.text, 'Answer to the new message.');
      assert.equal(executionsIn(browser).length, 1);
    } finally {
      resetTabSessions();
      await Promise.allSettled([turn]);
      model.restore();
      browser.restore();
    }
  });
}

test('when the on-device model reaches the limit first, tool-only history stays and the chat goes on', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const { max } = DEFAULT_TOOL_ROUND_LIMITS;
  const inventedTool: ModelReply = [
    { type: 'tool-call', value: { callID: '', name: '_0_invented_tool', arguments: {} } },
  ];
  // The model keeps calling a tool that does not exist. The on-device backend
  // turns those calls down by itself, and gives up on the model at the limit.
  const model = installOnDeviceModel([
    ...Array.from({ length: max + 1 }, () => inventedTool),
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: {} } }],
    ...Array.from({ length: max }, () => inventedTool),
  ]);
  const loggedErrors: unknown[][] = [];
  const { error: originalError, warn: originalWarn } = console;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };
  console.warn = () => {};

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const options = { onDeviceModel: true, sensitiveActionAlerts: false };
    const limitMessage = new ToolRoundLimitError(max).message;

    // Stopped before any call was run.
    const tab1 = readSession(1, options);
    tab1.setUserPrompt('Open the secret door');
    await tab1.handleSendPrompt();
    const chatId = tabSessions.getInternals(1).chatId;
    assert.ok(chatId);
    assert.deepEqual(
      readSession(1, options).messages.map((message) => [message.role, message.text]),
      [
        ['user', 'Open the secret door'],
        ['error', limitMessage],
      ]
    );

    // Stopped after one call was run.
    tab1.setUserPrompt('Book a table, then open the door');
    await tab1.handleSendPrompt();
    const finished = readSession(1, options);
    assert.deepEqual(
      finished.messages.slice(2).map((message) => message.role),
      ['user', 'ai', 'error']
    );
    assert.equal(finished.messages[4].text, limitMessage);
    // What ran stays with what the model said, as at the agent's own limit.
    assert.equal(executionsIn(browser).length, 1);
    assert.equal(finished.messages[3].activityLogs?.length, 1);
    assert.deepEqual(finished.messages[3].activityLogs, finished.activityLog);
    assert.equal(finished.messages[3].text, '');
    assert.equal(finished.messages[3].onDevice, true);
    assert.equal(finished.busy, false);

    // Neither stop is a failure, and both leave the chat as it was.
    assert.equal(tabSessions.getInternals(1).chatId, chatId);
    assert.deepEqual(loggedErrors, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    resetTabSessions();
    model.restore();
    browser.restore();
  }
});
