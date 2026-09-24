/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { postToBackend, streamChat } from './backendBridge.js';
import { getSpotlightFence, resetOnDeviceChat, sendOnDeviceChat } from './promptApiBackend.js';
import { ChatTurnRequest, ChatTurnResponse } from '../types/index.js';

/**
 * Routes a chat turn to where the user asked for it to run: the browser's
 * built-in model through the Prompt API, or the local server. Both take the
 * same request and answer with the same shape, so the agent loop does not care
 * which one runs. Both stream: `onText` gets the text of the turn so far as it
 * is written.
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
    // A new message with no chatId starts a new chat. Without an id here, the
    // on-device backend would carry on with whichever tab's chat it holds.
    // The server makes its own id, so only this path needs one.
    return sendOnDeviceChat(
      {
        ...request,
        chatId: request.chatId || (request.toolResponses ? undefined : crypto.randomUUID()),
      },
      { signal, onText }
    );
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

/**
 * Ends one conversation on the backend that holds it, so it stops taking up
 * context there. Other tabs' conversations are left alone.
 */
export function endChat(chatId: string, { onDevice = false }: { onDevice?: boolean } = {}): void {
  if (onDevice) {
    resetOnDeviceChat(chatId);
  } else {
    void postToBackend('/api/chat/reset', { chatId }).catch(() => {});
  }
}

/** Ends every conversation on one backend. */
export function endAllChats({ onDevice = false }: { onDevice?: boolean } = {}): void {
  if (onDevice) {
    resetOnDeviceChat();
  } else {
    void postToBackend('/api/chat/reset', {}).catch(() => {});
  }
}
