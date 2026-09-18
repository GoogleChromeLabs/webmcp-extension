/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  domainFor,
  faviconFor,
  getChrome,
  getTabInfo,
  requestTabTools,
} from '../services/extensionBridge.js';
import { tabSessions } from '../services/tabSessionStore.js';
import { originOfUrl } from '../services/toolPermissions.js';
import { WebMCPTool } from '../types/index.js';

export interface UseActiveTabToolsReturn {
  tools: WebMCPTool[];
  domain: string;
  /**
   * The full origin of the active tab, such as `https://example.com`, or an
   * empty string for a page that has none. Permission grants are scoped to it
   * rather than to `domain`, which drops the scheme and the port.
   */
  origin: string;
  favicon: string;
  statusMsg: string;
}

interface ToolsReport {
  message?: string;
  tools?: WebMCPTool[];
  url?: string;
  type?: string;
  action?: string;
}

/**
 * Keeps each tab's WebMCP tools, domain, origin and favicon up to date, and
 * returns those of the tab in front.
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

  const tabSeqRef = useRef<Map<number, number>>(new Map());
  const bumpTabSeq = (tabId: number): number => {
    const next = (tabSeqRef.current.get(tabId) ?? 0) + 1;
    tabSeqRef.current.set(tabId, next);
    return next;
  };

  const refreshTab = useCallback(async (tabId: number) => {
    const seq = bumpTabSeq(tabId);
    const info = await getTabInfo(tabId);
    const stillTracked = tabId === activeTabIdRef.current || tabSessions.hasConversation(tabId);
    if (info && stillTracked && tabSeqRef.current.get(tabId) === seq) {
      tabSessions.update(tabId, {
        domain: info.domain,
        origin: originOfUrl(info.url || ''),
        favicon: info.favicon,
      });
    }

    try {
      await requestTabTools(tabId);
    } catch (err: unknown) {
      if (tabId === activeTabIdRef.current || tabSessions.hasConversation(tabId)) {
        tabSessions.update(tabId, { statusMsg: String(err) });
      }
    }
  }, []);

  // One listener for the whole panel, filing every page's reports under its
  // own tab.
  useEffect(() => {
    const chromeApi = getChrome();
    if (!chromeApi?.runtime) return;

    const listener = ({ message, tools, url, type, action }: ToolsReport, sender?: chrome.runtime.MessageSender) => {
      // Internal signals (e.g. contentScriptReady) are handled elsewhere.
      if (type || action) return;
      if (sender?.frameId && sender.frameId !== 0) return;
      if (tools === undefined && message === undefined && !url) return;

      // A report with no tab comes from the service worker, which only speaks
      // for the tab in front.
      const tabId = sender?.tab?.id ?? activeTabIdRef.current;
      if (tabId == null) return;

      const pageUrl = url || sender?.tab?.url || '';
      if (pageUrl) bumpTabSeq(tabId);
      tabSessions.update(tabId, (previous) => ({
        statusMsg: message !== undefined ? message : tools !== undefined ? '' : previous.statusMsg,
        tools: tools !== undefined ? tools : previous.tools,
        domain: pageUrl ? domainFor(pageUrl) : previous.domain,
        origin: pageUrl ? originOfUrl(pageUrl) : previous.origin,
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
    const chromeApi = getChrome();
    if (!chromeApi?.tabs) return;

    const onUpdated = (tabId: number, changeInfo: { status?: string; url?: string }) => {
      const isTracked = tabId === activeTabIdRef.current || tabSessions.hasConversation(tabId);
      if (!isTracked) {
        tabSeqRef.current.delete(tabId);
        return;
      }
      // The tools of the page being left no longer exist. Clearing them keeps
      // a turn from declaring tools that have gone.
      if (changeInfo.url) {
        tabSessions.update(tabId, {
          tools: [],
          statusMsg: '',
          domain: domainFor(changeInfo.url),
          origin: originOfUrl(changeInfo.url),
          favicon: faviconFor(changeInfo.url),
        });
      }
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
    origin: session.origin,
    favicon: session.favicon,
    statusMsg: session.statusMsg,
  };
}
