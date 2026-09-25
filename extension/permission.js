/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const statusEl = document.getElementById('status');
const requestBtn = document.getElementById('request-btn');

async function requestMic() {
  if (statusEl) {
    statusEl.textContent = 'Requesting microphone access...';
    statusEl.dataset.state = 'pending';
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all audio tracks immediately once permission is secured
    stream.getTracks().forEach((track) => track.stop());

    if (statusEl) {
      statusEl.textContent = 'Permission granted! Returning to extension...';
      statusEl.dataset.state = 'granted';
    }

    // Broadcast permission success to the side panel
    chrome.runtime
      ?.sendMessage?.({
        type: 'WEBMCP_MIC_PERMISSION_RESULT',
        granted: true,
      })
      ?.catch?.(() => {});

    // Close the helper tab after a brief moment
    setTimeout(() => {
      window.close();
    }, 500);
  } catch (err) {
    console.error('Microphone permission request error:', err);
    if (statusEl) {
      statusEl.textContent = 'Permission dismissed. Click Prompt Again and select Allow.';
      statusEl.dataset.state = 'denied';
    }
  }
}

if (requestBtn) {
  requestBtn.addEventListener('click', requestMic);
}

// Request immediately upon opening the page
requestMic();
