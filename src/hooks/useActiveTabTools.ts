/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react';
import { ensureChromeAPI, requestTabTools } from '../services/extensionBridge.js';
import { WebMCPTool } from '../types/index.js';

export interface UseActiveTabToolsReturn {
  tools: WebMCPTool[];
  toolsRef: MutableRefObject<WebMCPTool[]>;
  domain: string;
  favicon: string;
  statusMsg: string;
  refreshActiveTab: () => Promise<void>;
}

/**
 * Hook for managing active tab WebMCP tools, domain, and favicon synchronization.
 */
export function useActiveTabTools(): UseActiveTabToolsReturn {
  const [tools, setTools] = useState<WebMCPTool[]>([]);
  const [domain, setDomain] = useState<string>('');
  const [favicon, setFavicon] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const toolsRef = useRef<WebMCPTool[]>(tools);
  toolsRef.current = tools;

  const refreshActiveTab = useCallback(async () => {
    ensureChromeAPI();
    if (!window.chrome?.tabs) return;

    try {
      const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      if (tab.favIconUrl) {
        setFavicon(tab.favIconUrl);
      } else if (tab.url) {
        try {
          const u = new URL(tab.url);
          setFavicon(`https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`);
        } catch {}
      }

      if (tab.url) {
        try {
          const u = new URL(tab.url);
          setDomain(u.hostname);
        } catch {
          setDomain(tab.url);
        }
      }

      await requestTabTools();
    } catch (err: unknown) {
      const error = err as { message?: string };
      if (!error?.message?.includes('Could not establish connection') && !error?.message?.includes('Receiving end does not exist')) {
        setStatusMsg(String(err));
      }
    }
  }, []);

  useEffect(() => {
    ensureChromeAPI();
    if (!window.chrome?.runtime) return;

    const listener = async (
      { message, tools: newTools, url }: { message?: string; tools?: WebMCPTool[]; url?: string },
      sender?: chrome.runtime.MessageSender
    ) => {
      if (sender?.frameId && sender.frameId !== 0) return;
      const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
      if (sender?.tab && tab?.id && sender.tab.id !== tab.id) return;

      setStatusMsg(message || '');

      const parsedTools = newTools || [];
      setTools(parsedTools);
      toolsRef.current = parsedTools;

      const pageUrl = url || sender?.tab?.url || tab?.url || '';
      try {
        const parsedUrl = new URL(pageUrl);
        setDomain(parsedUrl.hostname);
        const iconUrl =
          sender?.tab?.favIconUrl || tab?.favIconUrl || `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`;
        setFavicon(iconUrl);
      } catch {
        setDomain(pageUrl || 'New Tab');
        if (sender?.tab?.favIconUrl || tab?.favIconUrl) {
          setFavicon(sender?.tab?.favIconUrl || tab?.favIconUrl || '');
        }
      }
    };

    window.chrome.runtime.onMessage.addListener(listener);

    const onTabActivated = () => refreshActiveTab();
    const onTabUpdated = (_tabId: number, changeInfo: { status?: string; url?: string }) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        refreshActiveTab();
      }
    };

    if (window.chrome.tabs) {
      window.chrome.tabs.onActivated?.addListener(onTabActivated);
      window.chrome.tabs.onUpdated?.addListener(onTabUpdated);
    }

    refreshActiveTab();

    return () => {
      window.chrome.runtime.onMessage.removeListener(listener);
      if (window.chrome.tabs) {
        window.chrome.tabs.onActivated?.removeListener(onTabActivated);
        window.chrome.tabs.onUpdated?.removeListener(onTabUpdated);
      }
    };
  }, [refreshActiveTab]);

  return {
    tools,
    toolsRef,
    domain,
    favicon,
    statusMsg,
    refreshActiveTab,
  };
}
