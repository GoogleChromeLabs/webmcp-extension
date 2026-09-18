/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { getTabInfo, requestTabTools } from '../services/extensionBridge.js';
import { tabSessions } from '../services/tabSessionStore.js';
import { WebMCPTool } from '../types/index.js';

export interface UseActiveTabToolsReturn {
  tools: WebMCPTool[];
  domain: string;
  favicon: string;
  statusMsg: string;
  refreshActiveTab: () => Promise<void>;
}

interface ToolsReport {
  message?: string;
  tools?: WebMCPTool[];
  url?: string;
  type?: string;
  action?: string;
}

/** The favicon a tab reports, or one derived from its host. */
function faviconFor(url: string, reported?: string): string {
  if (reported) return reported;
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return '';
  }
}

/** The host a URL belongs to, falling back to the URL when it has no host. */
function domainFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || 'New Tab';
  }
}

/**
 * Keeps each tab's WebMCP tools, domain and favicon up to date, and returns
 * those of the tab in front.
 *
 * Reports are filed under the tab that sent them rather than only kept for the
 * active one: a turn that is still running in a background tab needs that
 * tab's current tools to declare on its next request, not the tools of
 * whatever page the user has moved on to.
 */
export function useActiveTabTools(activeTabId: number | null): UseActiveTabToolsReturn {
  const readSession = () => tabSessions.getState(activeTabId);
  const session = useSyncExternalStore(tabSessions.subscribe, readSession, readSession);

  // Reports that name no tab belong to the tab in front, and the listener
  // below is installed once, so it reads the id from here.
  const activeTabIdRef = useRef<number | null>(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const refreshTab = useCallback(async (tabId: number) => {
    const info = await getTabInfo(tabId);
    if (info) {
      tabSessions.update(tabId, {
        domain: info.domain,
        favicon: info.favicon || faviconFor(info.url || ''),
      });
    }

    try {
      await requestTabTools(tabId);
    } catch (err: unknown) {
      const error = err as { message?: string };
      const unreachable =
        error?.message?.includes('Could not establish connection') ||
        error?.message?.includes('Receiving end does not exist');
      if (!unreachable) {
        tabSessions.update(tabId, { statusMsg: String(err) });
      }
    }
  }, []);

  const refreshActiveTab = useCallback(async () => {
    const tabId = activeTabIdRef.current;
    if (tabId == null) return;
    await refreshTab(tabId);
  }, [refreshTab]);

  // One listener for the whole panel, filing every page's reports under its
  // own tab.
  useEffect(() => {
    const chromeApi = window.chrome;
    if (!chromeApi?.runtime) return;

    const listener = ({ message, tools, url, type, action }: ToolsReport, sender?: chrome.runtime.MessageSender) => {
      // Internal signals (e.g. contentScriptReady) are handled elsewhere.
      if (type || action) return;
      if (sender?.frameId && sender.frameId !== 0) return;

      // A report with no tab comes from the service worker, which only speaks
      // for the tab in front.
      const tabId = sender?.tab?.id ?? activeTabIdRef.current;
      if (tabId == null) return;

      const pageUrl = url || sender?.tab?.url || '';
      tabSessions.update(tabId, (previous) => ({
        statusMsg: message !== undefined ? message : previous.statusMsg,
        tools: tools !== undefined ? tools : previous.tools,
        domain: pageUrl ? domainFor(pageUrl) : previous.domain,
        favicon: pageUrl ? faviconFor(pageUrl, sender?.tab?.favIconUrl) : previous.favicon,
      }));
    };

    chromeApi.runtime.onMessage.addListener(listener);
    return () => {
      chromeApi.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Pages change under tabs the panel is holding a conversation for, not only
  // under the one in front, so those are followed too.
  useEffect(() => {
    const chromeApi = window.chrome;
    if (!chromeApi?.tabs) return;

    const onUpdated = (tabId: number, changeInfo: { status?: string; url?: string }) => {
      const isTracked = tabId === activeTabIdRef.current || tabSessions.has(tabId);
      if (!isTracked) return;
      // The tools of the page being left no longer exist. Clearing them keeps
      // a turn from declaring tools that have gone.
      if (changeInfo.url) tabSessions.update(tabId, { tools: [], statusMsg: '' });
      if (changeInfo.status === 'complete' || changeInfo.url) void refreshTab(tabId);
    };

    chromeApi.tabs.onUpdated?.addListener(onUpdated);
    return () => {
      chromeApi.tabs.onUpdated?.removeListener(onUpdated);
    };
  }, [refreshTab]);

  // Whichever tab comes to the front is read afresh, since its page may have
  // changed while the panel was showing another tab.
  useEffect(() => {
    if (activeTabId == null) return;
    void refreshTab(activeTabId);
  }, [activeTabId, refreshTab]);

  return {
    tools: session.tools,
    domain: session.domain,
    favicon: session.favicon,
    statusMsg: session.statusMsg,
    refreshActiveTab,
  };
}

export default useActiveTabTools;
