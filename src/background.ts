/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAllFrameOrigins } from './frameOrigins.js';

// Allows users to open the side panel by clicking the action icon.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.action.setBadgeBackgroundColor({ color: '#0c7a92' });

// The manifest's `content_scripts` entry only reaches pages that load after
// the extension is installed. Tabs that were already open (on install, and on
// every update or reload, which cuts their old copy off from the extension)
// would have no content script until they are reloaded, so it is injected into
// them here.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const { id: tabId } of tabs) {
    if (tabId === undefined) continue;
    chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
      // Pages the extension may not script, e.g. chrome:// and the Web Store.
      .catch(() => {});
  }
});

// Update badge text with the number of tools per tab.
chrome.tabs.onUpdated.addListener((tabId) => updateBadge(tabId));
chrome.webNavigation.onCompleted.addListener(({ tabId }) => updateBadge(tabId));

async function updateBadge(tabId: number): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== tabId) return;
  chrome.action.setBadgeText({ text: '', tabId });
  const fromOrigins = await getAllFrameOrigins(tabId);
  const message = { action: 'LIST_TOOLS', fromOrigins };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    // Expected on tabs where the content script cannot run (e.g.
    // chrome://newtab) or has not attached yet. Forwarding it would surface raw
    // Chrome IPC errors in the UI, so it is only logged.
    console.debug('[WebMCP] tabs.sendMessage failed:', error);
  }
}

interface RuntimeMessage {
  action?: string;
  tools?: unknown[];
}

chrome.runtime.onMessage.addListener(
  ({ action, tools }: RuntimeMessage, { tab, frameId }, sendResponse) => {
    if (action === 'INJECT_GET_FRAME_ID') {
      // `tab` is undefined for messages from the side panel, which has no tab.
      if (!tab?.id) {
        sendResponse();
        return;
      }
      void injectFrameIdListener(tab.id, () => sendResponse());
      // Keeps the message channel open until `sendResponse` is called.
      return true;
    }
    if (action === 'GET_FRAME_ID') {
      sendResponse(frameId);
      return;
    }
    if (tools !== undefined && tab?.id) {
      const text = tools.length ? `${tools.length}` : '';
      chrome.action.setBadgeText({ text, tabId: tab.id });
    }
  }
);

/** Injects the frame-id listener into every frame of the tab, then calls `done`. */
async function injectFrameIdListener(tabId: number, done: () => void): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: listenForFrameIdRequests });
  } catch {
    // The tab navigated away or cannot be scripted; the caller times out.
  } finally {
    done();
  }
}

/**
 * Answers a parent frame asking for this frame's id. Injected into the page
 * with `chrome.scripting.executeScript`, so it is serialized and must not use
 * anything from outside its own body.
 */
function listenForFrameIdRequests(): void {
  // This function is re-injected on every INJECT_GET_FRAME_ID request;
  // only register the listener once per document.
  if (window.webmcpFrameIdListenerInstalled) return;
  window.webmcpFrameIdListenerInstalled = true;
  window.addEventListener('message', async ({ data, source, origin }) => {
    // Any frame can post anything here, so `data` may not be an object, and
    // `source` is null when the sending context has already gone away.
    if (data?.action !== 'GET_FRAME_ID' || !source) return;
    for (let attempt = 0; attempt < 10; attempt++) {
      const frameId: number | undefined = await chrome.runtime.sendMessage({ action: 'GET_FRAME_ID' });
      if (frameId != null) {
        (source as Window).postMessage({ action: 'GET_FRAME_ID_RESPONSE', frameId }, origin);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.debug('[WebMCP] failed to get frameId after 10 attempts');
  });
}
