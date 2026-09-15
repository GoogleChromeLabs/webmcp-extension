/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { callBackend } from './backendBridge.js';
import { getSpotlightFence, resetOnDeviceChat, sendOnDeviceChat } from './promptApiBackend.js';
import { ChatTurnRequest, ChatTurnResponse } from '../types/index.js';

/**
 * Routes a chat turn to the backend the user picked: the local server, which
 * calls Gemini, or the browser's built-in model through the Prompt API. Both
 * take the same request and answer with the same shape, so the agent loop does
 * not care which one runs.
 */
export async function sendChatTurn(
  request: ChatTurnRequest,
  options: { signal?: AbortSignal; onDevice?: boolean } = {}
): Promise<ChatTurnResponse> {
  const { signal, onDevice } = options;
  if (onDevice) {
    return sendOnDeviceChat(request, { signal });
  }
  return callBackend<ChatTurnResponse>('/api/chat', request, { signal });
}

/**
 * How untrusted tool results are spotlighted for the backend in use: the
 * server's Gemini model decodes base64, the on-device model does not, so its
 * results are fenced instead.
 */
export function getSpotlighting(options: { onDevice?: boolean } = {}): string | undefined {
  return options.onDevice ? getSpotlightFence() : undefined;
}

/** Ends the conversation on whichever backend is holding it. */
export function resetChatSession(options: { chatId?: string; onDevice?: boolean } = {}): void {
  const { chatId, onDevice } = options;
  if (onDevice) {
    resetOnDeviceChat();
    return;
  }
  if (chatId) {
    callBackend('/api/reset', { chatId }).catch(() => {});
  }
}
