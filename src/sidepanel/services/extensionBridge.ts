/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAllFrameOrigins } from '../../frameOrigins.js';

interface GlobalWindowWithChrome {
  chrome?: typeof chrome;
}

export function getChrome(): typeof chrome | undefined {
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

/** The host a URL belongs to, falling back to 'New Tab' for internal browser pages or invalid URLs. */
export function domainFor(url?: string): string {
  if (!url) return 'New Tab';
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname : 'New Tab';
  } catch {
    return 'New Tab';
  }
}

/**
 * The favicon a tab reports, or else the one Chrome has cached for the page,
 * read through the extension's own `_favicon` endpoint (the `favicon`
 * permission). That keeps the lookup inside the browser instead of sending
 * the page's domain to a remote favicon service.
 */
export function faviconFor(url?: string, reported?: string): string {
  if (reported) return reported;
  const chromeApi = getChrome();
  if (!url || domainFor(url) === 'New Tab' || !chromeApi?.runtime?.getURL) return '';
  const faviconUrl = new URL(chromeApi.runtime.getURL('/_favicon/'));
  faviconUrl.searchParams.set('pageUrl', url);
  faviconUrl.searchParams.set('size', '32');
  return faviconUrl.toString();
}

/** A tab's display details, with a fallback favicon when the page has none. */
function describeTab(tab: chrome.tabs.Tab): TabInfo {
  return {
    tabId: tab.id,
    url: tab.url,
    domain: domainFor(tab.url),
    favicon: faviconFor(tab.url, tab.favIconUrl),
  };
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
 * Asks the page in `tabId` to report its tools. The report arrives later as a
 * runtime message, which useActiveTabTools files under the tab.
 */
export async function requestTabTools(tabId: number): Promise<void> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return;

  try {
    const fromOrigins = await getAllFrameOrigins(tabId);
    await chromeApi.tabs.sendMessage(tabId, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
  } catch {
    // The tab has no content script (e.g. chrome://, New Tab) or navigated away.
  }
}

/**
 * Executes a tool on the target Chrome tab/iframe.
 *
 * `tabId` is the tab the turn belongs to, not whichever tab is in front: the
 * user may switch tabs mid-turn, and the tool must still run on the page that
 * asked for it.
 *
 * A tool can also open a tab of its own, and the flow then carries on there.
 * `onTabChanged` reports that, so the rest of the turn works with the page it
 * has ended up on rather than the one it started from.
 */
export async function executeTabTool(
  name: string,
  inputArgs: Record<string, unknown>,
  frameId: number,
  tabId: number,
  options: { onTabChanged?: (tabId: number) => void } = {}
): Promise<unknown> {
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) throw new Error('No active tab available for tool execution.');

  let targetTabId = tabId;

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
      if (sender.tab.id === tabId || sender.tab.openerTabId === tabId) {
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
    if (targetTabId !== tabId) {
      options.onTabChanged?.(targetTabId);
      void requestTabTools(targetTabId).catch(() => {});
    }
    await raceWithTimeout(toolsPromise, 2000);

    await waitForPageLoad(targetTabId);

    return await chromeApi.tabs.sendMessage(
      targetTabId,
      { action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT' },
      // The original frameId only makes sense in the original tab.
      { frameId: targetTabId === tabId ? frameId : 0 },
    );
  } finally {
    chromeApi.runtime.onMessage.removeListener(listener);
  }
}

async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timerId = setTimeout(resolve, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }
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
    if (typeof chromeApi.tabs.get === 'function') void finishIfLoaded(chromeApi, tabId, done);
  });
}

async function finishIfLoaded(chromeApi: typeof chrome, tabId: number, done: () => void): Promise<void> {
  try {
    const tab = await chromeApi.tabs.get(tabId);
    if (tab?.status === 'complete') done();
  } catch {
    done();
  }
}
