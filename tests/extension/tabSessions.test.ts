/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { useAgentSession, type UseAgentSessionOptions, type UseAgentSessionReturn } from '../../extension/sidepanel/hooks/useAgentSession.js';
import { useActiveTabTools } from '../../extension/sidepanel/hooks/useActiveTabTools.js';
import { useActiveTabId } from '../../extension/sidepanel/hooks/useActiveTabId.js';
import { requestTabTools, executeTabTool, getTabInfo } from '../../extension/sidepanel/services/extensionBridge.js';
import { resetOnDeviceChat } from '../../extension/sidepanel/services/promptApiBackend.js';
import { tabSessions } from '../../extension/sidepanel/services/tabSessionStore.js';
import { clearSessionToolPermissions } from '../../extension/sidepanel/services/toolPermissions.js';
import { DEFAULT_TOOL_ROUND_LIMITS, ToolRoundLimitError } from '../../extension/sidepanel/services/toolRoundLimits.js';
import { type WebMCPTool } from '../../extension/sidepanel/types/index.js';

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

test('a tool can open a tab without moving the conversation, and Stop ignores late page metadata', async () => {
  resetTabSessions();
  const originalChrome = globalThis.chrome;
  const backend = installBackend([
    { chatId: 'chat-tab-1', text: '', functionCalls: [{ name: '_0_book_table', args: {} }] },
    { chatId: 'chat-tab-1', text: 'Confirmed on the new page.', functionCalls: [] },
    asksForTable(2),
  ]);

  const sent: SentMessage[] = [];
  let readyListener: ((message: unknown, sender: unknown) => void) | null = null;
  const metadata = Promise.withResolvers<chrome.tabs.Tab>();
  let holdMetadata = false;
  let resultCollected = false;
  let metadataRequested = false;
  let turn: Promise<void> | undefined;

  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 1, url: 'https://tab-1.example' }] as chrome.tabs.Tab[],
      get: async (tabId: number) => {
        if (holdMetadata && resultCollected) {
          metadataRequested = true;
          return metadata.promise;
        }
        return { id: tabId, status: 'complete' } as chrome.tabs.Tab;
      },
      sendMessage: async (tabId: number, message: SentMessage['message']) => {
        sent.push({ tabId, message });
        if (message.action === 'EXECUTE_TOOL') {
          resultCollected = false;
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
        if (message.action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') resultCollected = true;
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
    turn = tab1.handleSendPrompt();
    await turn;

    // The result was collected from the tab the tool opened...
    const collected = sent.find(({ message }) => message.action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT');
    assert.equal(collected?.tabId, 7);
    // ...and the turn went on with that page's tools.
    const declared = (backend.requests[1].tools as Array<{ name: string }>).map((tool) => tool.name);
    assert.deepEqual(declared, ['_0_confirm_booking']);

    // The conversation stayed where the user started it.
    assert.equal(readSession(1).messages.at(-1)?.text, 'Confirmed on the new page.');
    assert.deepEqual(tabSessions.getState(7).messages, []);

    // The page has finished the next tool, but its metadata lookup is still pending.
    holdMetadata = true;
    tab1.setUserPrompt('Book another table');
    turn = tab1.handleSendPrompt();
    await waitFor(() => metadataRequested, 'the new tab metadata lookup');
    tab1.handleStop();
    assert.equal(readSession(1).busy, false);
    assert.equal(readSession(1).messages.at(-1)?.activityLogs?.length, 1);
    tab1.handleReset();
    tabSessions.remove(7);
    const resetState = tabSessions.getState(1);

    metadata.resolve({ id: 7, status: 'complete', url: 'https://late.example/' } as chrome.tabs.Tab);
    await turn;
    assert.deepEqual(tabSessions.getState(1), resetState);
    assert.equal(tabSessions.tabIds().includes(7), false, 'late metadata must not restore the removed tab');
    assert.equal(backend.requests.length, 3, 'the stopped turn must not request another model reply');
    assert.equal(sent.filter(({ message }) => message.action === 'EXECUTE_TOOL').length, 2);
  } finally {
    resetTabSessions();
    metadata.resolve({ id: 7, status: 'complete' } as chrome.tabs.Tab);
    await Promise.allSettled([turn]);
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

test('Stop without text or activity adds no empty message', () => {
  resetTabSessions();
  try {
    const messages = [{ id: -1, role: 'user' as const, text: 'A cancelled request' }];
    tabSessions.update(1, { busy: true, streamingText: '  ', messages });
    const tab1 = readSession(1);
    tab1.handleStop();
    tab1.handleStop();
    assert.deepEqual(readSession(1).messages, messages);
    assert.equal(readSession(1).busy, false);
    assert.equal(readSession(1).streamingText, '');
  } finally {
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
  const backend = installBackend([asksForTable(1), asksForTable(2), asksForTable(3), asksForTable(4)]);
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
    assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai', 'error']);
    assert.deepEqual(finished.messages[1].activityLogs, finished.activityLog);
    assert.equal(finished.messages[1].activityLogs?.length, 3);
    assert.ok(finished.messages[1].activityLogs?.every((entry) => entry.done));
    assert.equal(
      finished.messages[2].text,
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

test('stopping at the question ends the turn and runs nothing more', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([asksForTable(1), asksForTable(2, 'One table booked. Booking the next one.')]);

  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, {
      sensitiveActionAlerts: false,
      toolRoundLimits: { askAfter: 1, max: 3 },
    });
    tab1.setUserPrompt('Book two tables');
    const turn = tab1.handleSendPrompt();

    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
    // What the model is about to do is on screen before the user decides.
    assert.equal(tabSessions.getState(1).messages.at(-1)?.text, 'One table booked. Booking the next one.');
    tabSessions.getState(1).pendingCheckpoint!.deny();
    await turn;

    assert.equal(executionsIn(browser).length, 1);
    assert.equal(backend.requests.length, 2);

    // The user asked for the stop, so there is no error, and what ran stays
    // with what the model said.
    const finished = readSession(1);
    assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai']);
    assert.equal(finished.messages[1].activityLogs?.length, 1);
    assert.equal(finished.pendingCheckpoint, null);
    assert.equal(finished.busy, false);
  } finally {
    resetTabSessions();
    backend.restore();
    browser.restore();
  }
});

for (const stop of ['toolbar', 'checkpoint'] as const) {
  test(`${stop} Stop preserves tool-only history and runs nothing more`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const backend = installBackend([asksForTable(1), asksForTable(2)]);
    let turn: Promise<void> | undefined;
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, {
        sensitiveActionAlerts: false,
        toolRoundLimits: { askAfter: 1, max: 3 },
      });
      tab1.setUserPrompt('Book tables');
      turn = tab1.handleSendPrompt();
      await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
      if (stop === 'toolbar') {
        tab1.handleStop();
        assert.equal(readSession(1).busy, false, 'toolbar Stop is immediate');
      } else {
        tabSessions.getState(1).pendingCheckpoint!.deny();
      }
      await turn;

      const stopped = readSession(1);
      assert.deepEqual(stopped.messages.map((message) => message.role), ['user', 'ai']);
      assert.equal(stopped.messages[1].text, '');
      assert.deepEqual(stopped.messages[1].activityLogs, stopped.activityLog);
      assert.equal(stopped.activityLog.length, 1);
      assert.equal(stopped.activityLog[0].done, true);
      assert.equal(stopped.pendingCheckpoint, null);
      assert.equal(stopped.busy, false);
      assert.equal(executionsIn(browser).length, 1);
      assert.equal(backend.requests.length, 2, 'Stop must not request a summary');
    } finally {
      resetTabSessions();
      await Promise.allSettled([turn]);
      backend.restore();
      browser.restore();
    }
  });
}

for (const { name, earlierText, finalText, roles } of [
  { name: 'a final answer', earlierText: 'One booked.', finalText: 'All booked.', roles: ['ai', 'ai'] },
  { name: 'an empty reply after earlier text', earlierText: 'One booked.', finalText: '', roles: ['ai', 'ai'] },
  { name: 'an empty reply without any text', earlierText: '', finalText: '', roles: ['ai', 'error'] },
]) {
  test(`completion with ${name} retains ordered logs exactly once in the current turn`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const backend = installBackend([asksForTable(1), asksForTable(2, earlierText), { text: finalText }]);
    const previousReply = { id: -1, role: 'ai' as const, text: 'A previous turn.' };
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL], messages: [previousReply] });
      const tab1 = readSession(1, { sensitiveActionAlerts: false });
      tab1.setUserPrompt('Book two tables');
      await tab1.handleSendPrompt();

      const finished = readSession(1);
      assert.deepEqual(finished.messages[0], previousReply);
      const replies = finished.messages.slice(2);
      assert.deepEqual(replies.map((message) => message.role), roles);
      assert.equal(finished.activityLog.length, 2);
      const [newer, older] = finished.activityLog;
      assert.ok(newer.id > older.id, 'stored logs are newest first');
      assert.ok(finished.activityLog.every((entry) => entry.done));
      if (earlierText) {
        assert.deepEqual(replies.map((message) => message.text), [earlierText, finalText]);
        assert.deepEqual(replies.map((message) => message.activityLogs), [[older], [newer]]);
      } else {
        assert.equal(replies[0].text, '');
        assert.deepEqual(replies[0].activityLogs, [newer, older]);
        assert.equal(replies[1].text, 'I couldn’t generate a response for that request. Please try again.');
      }
      assert.deepEqual(replies.flatMap((message) => [...(message.activityLogs ?? [])].reverse()), [older, newer]);
      assert.deepEqual(tabSessions.getInternals(1).turnLogs, []);
      assert.equal(finished.busy, false);
    } finally {
      resetTabSessions();
      backend.restore();
      browser.restore();
    }
  });
}

for (const ending of ['toolbar Stop', 'checkpoint Stop', 'limit', 'error'] as const) {
  test(`${ending} keeps trailing activity after earlier text`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const earlierText = 'I will book a table.';
    const backend = installBackend([
      asksForTable(1, earlierText),
      ending === 'error' ? { error: 'Internal failure details' } : asksForTable(2),
    ]);
    const originalError = console.error;
    console.error = () => {};
    let turn: Promise<void> | undefined;
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, {
        sensitiveActionAlerts: false,
        toolRoundLimits: { askAfter: 1, max: ending === 'limit' ? 1 : 3 },
      });
      tab1.setUserPrompt('Book tables');
      turn = tab1.handleSendPrompt();
      if (ending === 'toolbar Stop' || ending === 'checkpoint Stop') {
        await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
        if (ending === 'toolbar Stop') {
          tab1.handleStop();
          tab1.handleStop();
        } else {
          tabSessions.getState(1).pendingCheckpoint!.deny();
        }
      }
      await turn;

      const finished = readSession(1);
      const hasError = ending === 'limit' || ending === 'error';
      assert.deepEqual(finished.messages.map((message) => message.role),
        hasError ? ['user', 'ai', 'ai', 'error'] : ['user', 'ai', 'ai']);
      assert.equal(finished.messages[1].text, earlierText);
      assert.deepEqual(finished.messages[1].activityLogs, []);
      assert.equal(finished.messages[2].text, '');
      assert.deepEqual(finished.messages[2].activityLogs, finished.activityLog);
      assert.equal(finished.activityLog.length, 1);
      assert.equal(finished.activityLog[0].done, true);
      assert.deepEqual(tabSessions.getInternals(1).turnLogs, []);
      assert.equal(finished.busy, false);
      assert.equal(executionsIn(browser).length, 1);
      assert.equal(backend.requests.length, 2);
    } finally {
      resetTabSessions();
      await Promise.allSettled([turn]);
      console.error = originalError;
      backend.restore();
      browser.restore();
    }
  });
}

for (const partial of ['', 'Here is what I found so far.']) {
  test(`an error after tools preserves ${partial ? 'partial text and' : 'tool-only'} history`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const backend = installBackend([asksForTable(1), { text: partial, error: 'Internal failure details' }]);
    const originalError = console.error;
    console.error = () => {};
    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, { sensitiveActionAlerts: false });
      tab1.setUserPrompt('Book a table');
      await tab1.handleSendPrompt();

      const finished = readSession(1);
      assert.deepEqual(finished.messages.map((message) => message.role), ['user', 'ai', 'error']);
      assert.equal(finished.messages[1].text, partial);
      assert.deepEqual(finished.messages[1].activityLogs, finished.activityLog);
      assert.equal(finished.activityLog.length, 1);
      assert.equal(finished.activityLog[0].done, true);
      assert.equal(finished.messages[2].text, 'Something went wrong while processing your request. Please try again.');
      assert.equal(finished.streamingText, '');
      assert.equal(finished.busy, false);
      assert.equal(backend.resets.length, 1);
      assert.equal(tabSessions.getInternals(1).chatId, undefined);
    } finally {
      resetTabSessions();
      console.error = originalError;
      backend.restore();
      browser.restore();
    }
  });
}

test('Stop preserves partial output and ignores late replies while the next turn is busy', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
  const nextReply = Promise.withResolvers<Response>();
  const backend = installBackend([asksForTable(1), () => response, () => nextReply.promise]);
  const encoder = new TextEncoder();
  const partial = 'Here is what I found so far.';
  let turn: Promise<void> | undefined;
  let nextTurn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, { sensitiveActionAlerts: false });
    tab1.setUserPrompt('Book a table');
    turn = tab1.handleSendPrompt();
    await waitFor(() => backend.requests.length === 2, 'the streaming follow-up');
    stream.enqueue(encoder.encode(`${JSON.stringify({ delta: partial })}\n`));
    await waitFor(() => tabSessions.getState(1).streamingText === partial, 'partial text');
    const signal = tabSessions.getInternals(1).abortController!.signal;
    tab1.handleStop();
    tab1.handleStop();
    const stopped = readSession(1);
    assert.equal(signal.aborted, true);
    assert.equal(stopped.busy, false);
    assert.equal(stopped.streamingText, '');
    assert.deepEqual(stopped.messages.map((message) => message.role), ['user', 'ai']);
    assert.equal(stopped.messages[1].text, partial);
    assert.deepEqual(stopped.messages[1].activityLogs, stopped.activityLog);
    assert.equal(stopped.activityLog.length, 1);

    tab1.setUserPrompt('Next question');
    nextTurn = tab1.handleSendPrompt();
    await waitFor(() => backend.requests.length === 3, 'the next request');
    const pending = tabSessions.getState(1);
    const nextController = tabSessions.getInternals(1).abortController;
    stream.enqueue(encoder.encode(`${JSON.stringify({ done: true, text: 'Late reply.', functionCalls: [{ name: '_0_book_table', args: {} }] })}\n`));
    stream.close();
    await turn;
    assert.deepEqual(tabSessions.getState(1), pending);
    assert.equal(readSession(1).busy, true, 'late output must not finish the new turn');
    assert.equal(tabSessions.getInternals(1).abortController, nextController);
    nextReply.resolve(sseResponse({ text: 'New answer.' }));
    await nextTurn;
    assert.deepEqual(readSession(1).messages.slice(0, stopped.messages.length), stopped.messages);
    assert.equal(readSession(1).messages.at(-1)?.text, 'New answer.');
    assert.equal(executionsIn(browser).length, 1);
    assert.equal(backend.requests.length, 3);
  } finally {
    resetTabSessions();
    stream.error(new DOMException('Test cleanup', 'AbortError'));
    nextReply.resolve(sseResponse({ text: '' }));
    await Promise.allSettled([turn, nextTurn]);
    backend.restore();
    browser.restore();
  }
});

for (const nextAction of ['send', 'remove'] as const) {
  test(`a late tool completion after Stop cannot change history after ${nextAction}`, async () => {
    resetTabSessions();
    const browser = installTestChrome();
    const backend = installBackend([
      { functionCalls: [1, 2].map((id) => ({ id: String(id), name: '_0_book_table', args: {} })) },
      { text: 'New answer.' },
    ]);
    const pendingTool = Promise.withResolvers<unknown>();
    let turn: Promise<void> | undefined;
    let nextTurn: Promise<void> | undefined;
    const sendMessage = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = (async (tabId: number, message: SentMessage['message']) => {
      if (message.action === 'EXECUTE_TOOL') {
        browser.sent.push({ tabId, message });
        return pendingTool.promise;
      }
      return sendMessage(tabId, message);
    }) as typeof chrome.tabs.sendMessage;

    try {
      tabSessions.update(1, { tools: [BOOK_TOOL] });
      const tab1 = readSession(1, { sensitiveActionAlerts: false });
      tab1.setUserPrompt('Book two tables');
      turn = tab1.handleSendPrompt();
      await waitFor(() => executionsIn(browser).length === 1, 'the first tool to start');
      tab1.handleStop();
      assert.equal(readSession(1).messages[1].activityLogs?.[0].done, false);

      if (nextAction === 'send') {
        tab1.setUserPrompt('Next question');
        nextTurn = tab1.handleSendPrompt();
        await nextTurn;
      } else {
        tabSessions.remove(1);
      }
      const expected = tabSessions.getState(1);
      pendingTool.resolve({ booked: true });
      await turn;
      assert.deepEqual(tabSessions.getState(1), expected);
      assert.equal(executionsIn(browser).length, 1, 'the second tool must never start');
      assert.equal(backend.requests.length, nextAction === 'send' ? 2 : 1);
      if (nextAction === 'remove') assert.equal(tabSessions.tabIds().includes(1), false);
    } finally {
      resetTabSessions();
      pendingTool.resolve({});
      await Promise.allSettled([turn, nextTurn]);
      backend.restore();
      browser.restore();
    }
  });
}

test('Stop during a permission prompt retains the pending entry without executing it', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const backend = installBackend([asksForTable(1)]);
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1);
    tab1.setUserPrompt('Book a table');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingPermission !== null, 'permission');
    tab1.handleStop();
    await turn;
    const stopped = readSession(1);
    assert.equal(stopped.pendingPermission, null);
    assert.equal(stopped.busy, false);
    assert.equal(stopped.messages[1].activityLogs?.length, 1);
    assert.equal(stopped.messages[1].activityLogs?.[0].done, false);
    assert.equal(executionsIn(browser).length, 0);
    assert.equal(backend.requests.length, 1);
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
    backend.restore();
    browser.restore();
  }
});

/** One reply of the on-device model: what it says, and the tools it calls. */
type ModelReply = Array<
  string | { type: 'tool-call'; value: { callID: string; name: string; arguments: Record<string, unknown> } }
>;

/**
 * Just enough of the browser's Prompt API for the on-device backend: every
 * prompt streams the next reply of `script`.
 */
function installOnDeviceModel(script: ModelReply[]): { restore: () => void } {
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ['LanguageModel', 'LanguageModelToolCall', 'LanguageModelToolSuccess', 'LanguageModelToolError'];
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
      create: async () =>
        Object.assign(new EventTarget(), {
          contextUsage: 0,
          contextWindow: 1000,
          destroy: () => {},
          promptStreaming: () =>
            new ReadableStream({
              start(controller) {
                for (const chunk of script[turn++] ?? ['']) controller.enqueue(chunk);
                controller.close();
              },
            }),
        }),
    },
  });
  return {
    restore: () => {
      resetOnDeviceChat();
      for (const name of names) delete globals[name];
    },
  };
}

test('on-device toolbar Stop retains tool-only history', async () => {
  resetTabSessions();
  const browser = installTestChrome();
  const model = installOnDeviceModel([1, 2].map((id) => [
    { type: 'tool-call', value: { callID: String(id), name: '_0_book_table', arguments: { partySize: id } } },
  ]));
  let turn: Promise<void> | undefined;
  try {
    tabSessions.update(1, { tools: [BOOK_TOOL] });
    const tab1 = readSession(1, {
      onDeviceModel: true,
      sensitiveActionAlerts: false,
      toolRoundLimits: { askAfter: 1, max: 3 },
    });
    tab1.setUserPrompt('Book tables');
    turn = tab1.handleSendPrompt();
    await waitFor(() => tabSessions.getState(1).pendingCheckpoint !== null, 'the question');
    tab1.handleStop();
    await turn;

    const stopped = readSession(1);
    assert.deepEqual(stopped.messages.map((message) => message.role), ['user', 'ai']);
    assert.equal(stopped.messages[1].text, '');
    assert.equal(stopped.messages[1].onDevice, true);
    assert.deepEqual(stopped.messages[1].activityLogs, stopped.activityLog);
    assert.equal(stopped.activityLog.length, 1);
    assert.equal(stopped.activityLog[0].done, true);
    assert.equal(executionsIn(browser).length, 1);
    assert.equal(stopped.busy, false);
  } finally {
    resetTabSessions();
    await Promise.allSettled([turn]);
    model.restore();
    browser.restore();
  }
});

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
    assert.equal(finished.messages[3].text, '');
    assert.equal(finished.messages[3].onDevice, true);
    assert.deepEqual(tabSessions.getInternals(1).turnLogs, []);
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
