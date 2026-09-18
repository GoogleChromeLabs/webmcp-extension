/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAllFrameOrigins } from '../../extension/utils.js';

interface GlobalWindowWithChrome {
  chrome?: typeof chrome;
}

function getChrome(): typeof chrome | undefined {
  const win = (typeof window !== 'undefined'
    ? window
    : typeof globalThis !== 'undefined'
    ? globalThis
    : null) as (Window & GlobalWindowWithChrome) | null;
  return win?.chrome;
}

export interface TabInfo {
  tabId?: number;
  url?: string;
  domain: string;
  favicon: string;
}

/** A tab's display details, with a fallback favicon when the page has none. */
function describeTab(tab: chrome.tabs.Tab): TabInfo {
  let favicon = tab.favIconUrl || '';
  let domain = 'New Tab';

  if (tab.url) {
    try {
      const u = new URL(tab.url);
      domain = u.hostname;
      if (!favicon) {
        favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
      }
    } catch {
      domain = tab.url;
    }
  }

  return { tabId: tab.id, url: tab.url, domain, favicon };
}

/**
 * Queries active chrome tab details (URL, favicon, domain).
 */
export async function getActiveTabInfo(): Promise<TabInfo | null> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return null;
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return describeTab(tab);
}

/**
 * The details of one named tab, which the panel needs for tabs other than the
 * one in front: a turn running in the background still shows which page it is
 * working on once the user comes back to it.
 */
export async function getTabInfo(tabId: number): Promise<TabInfo | null> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs?.get) return null;
  try {
    const tab = await chromeApi.tabs.get(tabId);
    return tab ? describeTab(tab) : null;
  } catch {
    // The tab was closed between the event and this lookup.
    return null;
  }
}

/**
 * The tab a caller means: the one it names, or the active one when it does not
 * name any. A turn always names its own tab, so it keeps talking to the page
 * it started on even after the user has moved on to another.
 */
async function resolveTabId(tabId?: number): Promise<number | undefined> {
  if (tabId !== undefined) return tabId;
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return undefined;
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Requests the tools list from `tabId`, or from the active tab.
 */
export async function requestTabTools(tabId?: number): Promise<void> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return;
  const targetTabId = await resolveTabId(tabId);
  if (targetTabId === undefined) return;

  try {
    const fromOrigins = await getAllFrameOrigins(targetTabId);
    await chromeApi.tabs.sendMessage(targetTabId, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
  } catch (err: unknown) {
    const error = err as { message?: string };
    if (!error?.message?.includes('Could not establish connection') && !error?.message?.includes('Receiving end does not exist')) {
      throw err;
    }
  }
}


/**
 * Executes a tool on the target Chrome tab/iframe.
 *
 * `tabId` is the tab the turn belongs to. Without it the tool would run
 * against whichever tab is in front when the call happens, which is not the
 * one that asked for it as soon as the user switches tabs mid-turn.
 *
 * A tool can also open a tab of its own, and the flow then carries on there.
 * `onTabChanged` reports that, so the rest of the turn works with the page it
 * has ended up on rather than the one it started from.
 */
export async function executeTabTool(
  name: string,
  inputArgs: Record<string, unknown> | string,
  frameId?: number,
  tabId?: number,
  options: { onTabChanged?: (tabId: number) => void } = {}
): Promise<unknown> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) throw new Error('No active tab available for tool execution.');

  const currentTabId = await resolveTabId(tabId);
  if (currentTabId === undefined) throw new Error('No active tab available for tool execution.');

  let targetTabId = currentTabId;

  let toolsReady: () => void = () => {};
  const toolsPromise = new Promise<void>((resolve) => {
    toolsReady = resolve;
  });

  let contentScriptReadyResolve: () => void = () => {};
  const contentScriptReadyPromise = new Promise<void>((r) => {
    contentScriptReadyResolve = r;
  });

  const listener = (msg: { type?: string; tools?: unknown }, sender: chrome.runtime.MessageSender) => {
    if (msg?.type === 'contentScriptReady' && sender.tab) {
      if (sender.tab.id === currentTabId || sender.tab.openerTabId === currentTabId) {
        if (sender.tab.id !== undefined) {
          targetTabId = sender.tab.id;
        }
        contentScriptReadyResolve();
      }
    }
    if (msg?.tools && sender.tab?.id === targetTabId) {
      toolsReady();
    }
  };
  chromeApi.runtime.onMessage.addListener(listener);

  try {
    try {
      const result = await chromeApi.tabs.sendMessage(
        targetTabId,
        { action: 'EXECUTE_TOOL', name, inputArgs },
        { frameId },
      );
      if (result !== null) return result;
    } catch (err: unknown) {
      const error = err as { message?: string };
      if (!error.message || !/message channel (is )?closed/.test(error.message)) throw err;
    }

    // A navigation was triggered. The result will be on the next document,
    // which may live in a new tab if the tool opened one.
    await raceWithTimeout(contentScriptReadyPromise, 2000);
    await raceWithTimeout(toolsPromise, 2000);

    await waitForPageLoad(targetTabId);

    // The flow has moved to a tab the tool opened, so the caller's turn should
    // go on with that page rather than the one it started from.
    if (targetTabId !== currentTabId) options.onTabChanged?.(targetTabId);

    return await chromeApi.tabs.sendMessage(
      targetTabId,
      { action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT' },
      // The original frameId only makes sense in the original tab.
      { frameId: targetTabId === currentTabId ? frameId : 0 },
    );
  } finally {
    chromeApi.runtime.onMessage.removeListener(listener);
  }
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timerId = setTimeout(resolve, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timerId);
  });
}

function waitForPageLoad(tabId: number): Promise<void> {
  const chromeApi = getChrome();
  return new Promise((resolve) => {
    if (!chromeApi?.tabs) return resolve();

    let timeoutId: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timeoutId);
      chromeApi.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done();
    };

    timeoutId = setTimeout(done, 5000); // resolve rather than reject to avoid crashing the AI loop
    chromeApi.tabs.onUpdated.addListener(listener);

    // The tab may already be done loading, or gone; don't wait on the
    // timeout for those.
    if (typeof chromeApi.tabs.get === 'function') {
      chromeApi.tabs.get(tabId).then((tab) => {
        if (tab?.status === 'complete') done();
      }).catch(done);
    }
  });
}
