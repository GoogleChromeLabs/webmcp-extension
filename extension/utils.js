/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The distinct origins of every frame in a tab, so the content script can ask
 * `document.modelContext.getTools()` for tools from cross-origin iframes too.
 * Frames without an origin (about:blank, data: URLs) are left out.
 *
 * @param {number} tabId
 * @returns {Promise<string[]>}
 */
async function getAllFrameOrigins(tabId) {
  if (typeof chrome === 'undefined' || !chrome.webNavigation?.getAllFrames) {
    return [];
  }
  try {
    const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
    const origins = frames
      .map((frame) => {
        try {
          return new URL(frame.url).origin;
        } catch {
          return 'null';
        }
      })
      .filter((origin) => origin !== 'null');
    return [...new Set(origins)];
  } catch {
    return [];
  }
}

export { getAllFrameOrigins };
