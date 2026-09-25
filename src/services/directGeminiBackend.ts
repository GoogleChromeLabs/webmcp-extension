/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import { appendTurnMessages, buildTools } from '../../server/tools.js';
import { ChatTurnRequest, ChatTurnResponse, UserFacingError } from '../types/index.js';
import {
  getConfiguredTextModel,
  getDefaultLiveSystemInstruction,
  getGeminiApiKey,
  getGoogleBaseUrl,
} from './geminiLive.js';

const MAX_DIRECT_CHAT_SESSIONS = 100;
const directChatSessions = new Map<string, any[]>();

/**
 * Synchronizes voice or external turns into the in-extension Gemini chat session
 * so switching between Gemini 3.8 Live voice mode and text mode preserves context
 * even when no local Node server (`server/server.js`) is running.
 */
export function syncDirectGeminiHistory(
  chatId: string | undefined,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const currentChatId = chatId || crypto.randomUUID();
  let baseHistory = directChatSessions.get(currentChatId);
  if (!baseHistory) {
    if (directChatSessions.size >= MAX_DIRECT_CHAT_SESSIONS) {
      const oldestKey = directChatSessions.keys().next().value;
      if (oldestKey !== undefined) directChatSessions.delete(oldestKey);
    }
    baseHistory = [];
  }

  for (const msg of messages) {
    if (
      msg &&
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.content === 'string' &&
      msg.content.trim()
    ) {
      baseHistory.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  directChatSessions.delete(currentChatId);
  directChatSessions.set(currentChatId, baseHistory);
  return currentChatId;
}

export function resetDirectGeminiChat(chatId?: string): void {
  if (chatId) {
    directChatSessions.delete(chatId);
  } else {
    directChatSessions.clear();
  }
}

/**
 * Executes a streaming chat turn directly from the Chrome extension against
 * the Gemini API using `@ai-sdk/google`, requiring no local Node backend server.
 */
export async function sendDirectGeminiChat(
  request: ChatTurnRequest,
  options: {
    signal?: AbortSignal;
    onText?: (text: string) => void;
  } = {}
): Promise<ChatTurnResponse> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new UserFacingError(
      'No Gemini API key found. Add your Gemini API key in Settings (or GEMINI_API_KEY in .env) to use the extension without a server.'
    );
  }

  const baseUrl = getGoogleBaseUrl();
  const modelId = getConfiguredTextModel();
  const google = createGoogleGenerativeAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });

  const currentChatId = request.chatId || crypto.randomUUID();
  let baseHistory = directChatSessions.get(currentChatId);
  if (!baseHistory) {
    if (directChatSessions.size >= MAX_DIRECT_CHAT_SESSIONS) {
      const oldestKey = directChatSessions.keys().next().value;
      if (oldestKey !== undefined) directChatSessions.delete(oldestKey);
    }
    baseHistory = [];
  }

  const nextHistory = appendTurnMessages(baseHistory, {
    message: request.message,
    toolResponses: request.toolResponses,
  });
  directChatSessions.delete(currentChatId);
  directChatSessions.set(currentChatId, nextHistory);

  let fullText = '';
  try {
    const result = streamText({
      model: google(modelId),
      system: getDefaultLiveSystemInstruction(),
      messages: nextHistory,
      tools: buildTools(request.tools as any),
      abortSignal: options.signal,
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        fullText += part.text;
        options.onText?.(fullText);
      } else if (part.type === 'error') {
        throw part.error;
      }
    }

    const [response, rawToolCalls] = await Promise.all([result.response, result.toolCalls]);
    const functionCalls = rawToolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      args: (call.input as Record<string, unknown>) ?? {},
    }));

    if (!options.signal?.aborted && directChatSessions.get(currentChatId) === nextHistory) {
      directChatSessions.delete(currentChatId);
      directChatSessions.set(currentChatId, [...nextHistory, ...response.messages]);
    }

    return {
      chatId: currentChatId,
      text: fullText,
      functionCalls,
    };
  } catch (err) {
    if (directChatSessions.get(currentChatId) === nextHistory) {
      const partial = fullText.trim();
      if (options.signal?.aborted && partial) {
        directChatSessions.set(currentChatId, [
          ...nextHistory,
          { role: 'assistant', content: [{ type: 'text', text: partial }] },
        ]);
      } else if (baseHistory.length === 0) {
        directChatSessions.delete(currentChatId);
      } else {
        directChatSessions.set(currentChatId, baseHistory);
      }
    }
    throw err;
  }
}
