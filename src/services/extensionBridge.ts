/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIframeOrigins } from '../../extension/utils.js';
import { WebMCPTool } from '../types/index.js';

interface GlobalWindowWithChrome {
  chrome?: typeof chrome;
}

// Setup browser fallback for chrome extension APIs when outside Extension context
export function ensureChromeAPI(): void {
  const win = (typeof window !== 'undefined'
    ? window
    : typeof globalThis !== 'undefined'
    ? globalThis
    : null) as (Window & GlobalWindowWithChrome) | null;
  if (!win) return;

  if (!win.chrome || !win.chrome.tabs) {
    let messageListeners: Array<(message: unknown, sender: unknown) => void> = [];
    win.chrome = {
      tabs: {
        query: async () => [
          { id: 1, url: 'https://example.com', favIconUrl: 'https://example.com/favicon.ico' },
        ] as chrome.tabs.Tab[],
        sendMessage: async (tabId: number, message: { action: string }) => {
          console.log('[Mock Chrome] sendMessage:', message);
          if (message.action === 'LIST_TOOLS') {
            const response = {
              message: '',
              tools: [
                { name: 'read_page', description: 'Read page', inputSchema: '{"type":"object","properties":{}}' },
                { name: 'search_parameters', description: 'Search parameters', inputSchema: '{"type":"object","properties":{}}' },
                { name: 'apply_parameters', description: 'Apply parameters', inputSchema: '{"type":"object","properties":{}}' },
                { name: 'save', description: 'Save', inputSchema: '{"type":"object","properties":{}}' },
              ] as WebMCPTool[],
              url: 'https://example.com',
            };
            for (const listener of messageListeners) {
              listener(response, { frameId: 0, tab: { id: 1 } });
            }
          }
          return null;
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      } as unknown as typeof chrome.tabs,
      runtime: {
        onMessage: {
          addListener: (callback: (message: unknown, sender: unknown) => void) => {
            messageListeners.push(callback);
          },
          removeListener: (callback: (message: unknown, sender: unknown) => void) => {
            messageListeners = messageListeners.filter((l) => l !== callback);
          },
        },
      } as unknown as typeof chrome.runtime,
      webNavigation: {
        getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
      } as unknown as typeof chrome.webNavigation,
    } as typeof chrome;
  }
}

function getChrome(): typeof chrome | undefined {
  const win = (typeof window !== 'undefined'
    ? window
    : typeof globalThis !== 'undefined'
    ? globalThis
    : null) as (Window & GlobalWindowWithChrome) | null;
  return win?.chrome;
}

/**
 * Queries active chrome tab details (URL, favicon, domain).
 */
export async function getActiveTabInfo(): Promise<{ tabId?: number; url?: string; domain: string; favicon: string } | null> {
  ensureChromeAPI();
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return null;
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;

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
 * Requests tools list from current active tab.
 */
export async function requestTabTools(): Promise<void> {
  ensureChromeAPI();
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) return;
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const fromOrigins = await getIframeOrigins(tab.id);
    await chromeApi.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
  } catch (err: unknown) {
    const error = err as { message?: string };
    if (!error?.message?.includes('Could not establish connection') && !error?.message?.includes('Receiving end does not exist')) {
      throw err;
    }
  }
}

/**
 * Executes a tool on the target Chrome tab/iframe.
 */
export async function executeTabTool(name: string, inputArgs: string, location?: string): Promise<unknown> {
  ensureChromeAPI();
  const chromeApi = getChrome();
  if (!chromeApi?.tabs) throw new Error('No active tab available for tool execution.');

  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab available for tool execution.');

  const options = !location || location === tab.url ? { frameId: 0 } : {};
  try {
    const result = await chromeApi.tabs.sendMessage(
      tab.id,
      { action: 'EXECUTE_TOOL', name, inputArgs, location },
      options
    );
    if (result !== null) return result;
  } catch (err: unknown) {
    const error = err as { message?: string };
    if (!error.message?.includes('message channel is closed')) throw err;
  }

  await waitForPageLoad(tab.id);
  return await chromeApi.tabs.sendMessage(tab.id, {
    action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT',
    location,
  });
}

function waitForPageLoad(tabId: number): Promise<void> {
  ensureChromeAPI();
  const chromeApi = getChrome();
  return new Promise((resolve) => {
    if (!chromeApi?.tabs) return resolve();
    const listener = (updatedTabId: number, changeInfo: { status?: string; url?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chromeApi.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chromeApi.tabs.onUpdated.addListener(listener);
  });
}
