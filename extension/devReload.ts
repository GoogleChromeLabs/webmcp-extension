/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Added to the service worker by `npm run dev` only (see scripts/buildConfig.ts).

// Makes this a module, which keeps its names out of the global scope.
export {};

function connectToReloadServer(url: string): void {
  const socket = new WebSocket(url);
  socket.onmessage = ({ data }) => {
    if (data === 'reload') {
      chrome.runtime.reload();
      return;
    }
    console.error(`[WebMCP] Build failed:\n${data}`);
    chrome.runtime.sendMessage({ action: 'BUILD_ERRORS', errors: data }).catch(() => {});
  };
  // https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.websockets
  const keepAlive = setInterval(() => socket.send('keepalive'), 20 * 1000);
  socket.onclose = () => {
    clearInterval(keepAlive);
    setTimeout(() => connectToReloadServer(url), 1000);
  };
}

connectToReloadServer(process.env.WEBMCP_RELOAD_URL!);
