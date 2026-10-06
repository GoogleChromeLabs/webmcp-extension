/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Added to the side panel by `npm run dev` only (see scripts/buildConfig.ts).

chrome.runtime.onMessage.addListener(({ action, errors }: { action?: string; errors?: string }) => {
  if (action === 'BUILD_ERRORS') console.error(`[WebMCP] Build failed:\n${errors}`);
});
