/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { callBackend, streamChat } from './backendBridge.js';
import { resetDirectGeminiChat, sendDirectGeminiChat } from './directGeminiBackend.js';
import { getGeminiApiKey } from './geminiLive.js';
import { getSpotlightFence, resetOnDeviceChat, sendOnDeviceChat } from './promptApiBackend.js';
import { ChatTurnRequest, ChatTurnResponse } from '../types/index.js';

/**
 * Routes a chat turn to where the user asked for it to run: the browser's
 * built-in model through the Prompt API, the local server, or directly to the
 * Gemini API from the extension when no local backend server is running and a
 * Gemini API key is configured.
 */
export async function sendChatTurn(
  request: ChatTurnRequest,
  options: {
    signal?: AbortSignal;
    onDevice?: boolean;
    onText?: (text: string) => void;
  } = {}
): Promise<ChatTurnResponse> {
  const { signal, onDevice = false, onText } = options;
  if (onDevice) {
    return sendOnDeviceChat(
      {
        ...request,
        chatId: request.chatId || (request.toolResponses ? undefined : crypto.randomUUID()),
      },
      { signal, onText }
    );
  }
  // If a Gemini API key is configured in Settings or .env, execute directly
  // in-extension without requiring or waiting on a local Node server.
  if (getGeminiApiKey()) {
    return sendDirectGeminiChat(request, { signal, onText });
  }

  return streamChat('/api/chat', request, { signal, onText });
}

/**
 * How untrusted tool results are spotlighted for whatever answers the turn:
 * the server's model decodes base64, the on-device model does not, so its
 * results are fenced instead.
 */
export function getSpotlighting(onDevice = false): string | undefined {
  return onDevice ? getSpotlightFence() : undefined;
}

/** Ends the conversation wherever it is being held. */
export function resetChatSession(options: { chatId?: string; onDevice?: boolean } = {}): void {
  const hasSpecificChat = 'chatId' in options;
  const { chatId, onDevice } = options;

  // If a specific chatId was requested but is undefined (e.g. tab had no
  // conversation yet), do not touch the active session of another tab.
  if (hasSpecificChat && !chatId) return;

  resetOnDeviceChat(hasSpecificChat ? chatId : undefined);
  resetDirectGeminiChat(hasSpecificChat ? chatId : undefined);
  if (!onDevice) {
    void callBackend('/api/chat/reset', hasSpecificChat ? { chatId } : {}).catch(() => {});
  }
}



