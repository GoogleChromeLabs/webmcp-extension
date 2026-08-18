/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function getIframeOrigins(tabId) {
  if (
    typeof chrome === 'undefined' ||
    !chrome.webNavigation ||
    !chrome.webNavigation.getAllFrames
  ) {
    return [];
  }
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const origins = frames
      .filter((frame) => frame.frameId !== 0)
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

export { getIframeOrigins };
