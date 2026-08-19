/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function getAllFrameOrigins(tabId) {
  if (typeof chrome === 'undefined' || !chrome?.webNavigation?.getAllFrames) {
    return [];
  }
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const origins =
      frames
        ?.map((frame) => {
          try {
            return new URL(frame.url).origin;
          } catch (e) {
            return 'null';
          }
        })
        ?.filter((origin) => origin !== 'null') ?? [];

    return [...new Set(origins)];
  } catch (e) {
    return [];
  }
}

export { getAllFrameOrigins };
