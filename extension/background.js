/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIframeOrigins } from './utils.js';

// Allows users to open the side panel by clicking the action icon.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Inject content script in all injectable tabs first.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    chrome.scripting
      .executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content.js'],
      })
      .catch(() => {});
  }
});

// Update badge text with the number of tools per tab.
chrome.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));
chrome.tabs.onUpdated.addListener((tabId) => updateBadge(tabId));

async function updateBadge(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== tabId) return;
  chrome.action.setBadgeText({ text: '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#0c7a92' });
  const fromOrigins = await getIframeOrigins(tab.id);
  const message = { action: 'LIST_TOOLS', fromOrigins };
  chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch((err) => {
    chrome.runtime.sendMessage({ message: err?.message || String(err) });
  });
}

chrome.runtime.onMessage.addListener(({ tools }, sender) => {
  if (sender?.tab?.id && Array.isArray(tools)) {
    const text = tools.length ? `${tools.length}` : '';
    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
  }
});
