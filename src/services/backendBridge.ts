/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserFacingError, type ChatTurnResponse } from '../types/index.js';

/**
 * Base URL of the companion server.
 * At build time, esbuild statically replaces `process.env.WEBMCP_SERVER_URL`
 * with a literal derived from PORT in .env, so a non-default port still works.
 */
const SERVER_URL = process.env.WEBMCP_SERVER_URL || 'http://localhost:3000';

/**
 * Retrieves the active WebMCP auth token.
 * At build time, esbuild statically replaces `process.env.WEBMCP_AUTH_TOKEN`
 * with the string literal token from .env.
 */
function getAuthToken(): string {
  return process.env.WEBMCP_AUTH_TOKEN || '';
}

/**
 * Extracts a clean, human-readable message from an error string or object.
 * Upstream API errors often arrive as nested JSON strings with verbose `details`
 * arrays that should not be dumped verbatim into the chat UI.
 */
export function formatErrorMessage(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
        ? input
        : String(input ?? 'Unknown error');

  const trimmed = raw.trim();
  const braceIdx = trimmed.indexOf('{');
  if (braceIdx === -1) {
    return trimmed;
  }

  const prefix = trimmed.slice(0, braceIdx).trim();
  let candidate = trimmed.slice(braceIdx);
  let extractedMessage: string | undefined;
  let extractedCode: number | string | undefined;
  let extractedStatus: string | undefined;

  for (let depth = 0; depth < 5; depth++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      break;
    }

    if (typeof parsed === 'string') {
      candidate = parsed.trim();
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      break;
    }

    const record = parsed as Record<string, unknown>;
    const errField = record.error;

    if (typeof errField === 'string') {
      extractedMessage = errField;
      candidate = errField.trim();
      continue;
    }

    if (errField && typeof errField === 'object') {
      const errObj = errField as Record<string, unknown>;
      if (typeof errObj.code === 'number' || typeof errObj.code === 'string') {
        extractedCode = errObj.code;
      }
      if (typeof errObj.status === 'string') {
        extractedStatus = errObj.status;
      }
      if (typeof errObj.message === 'string') {
        extractedMessage = errObj.message;
        candidate = errObj.message.trim();
        continue;
      }
    }

    if (typeof record.message === 'string') {
      extractedMessage = record.message;
      candidate = record.message.trim();
      continue;
    }

    break;
  }

  if (!extractedMessage) {
    return trimmed;
  }

  const cleanMsg = extractedMessage.trim();
  const metaParts = [extractedCode, extractedStatus].filter(Boolean);
  const suffix = metaParts.length > 0 ? ` (${metaParts.join(' ')})` : '';
  const lead = prefix ? `${prefix.replace(/:$/, '')}: ` : '';
  return `${lead}${cleanMsg}${suffix}`;
}

/** The headers every request to the backend server carries. */
function buildHeaders(): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = getAuthToken();
  if (token) headers.set('X-WebMCP-Auth', token);
  return headers;
}

/**
 * POSTs a JSON body to the companion server and returns its JSON reply.
 */
export async function postToBackend<T = Record<string, unknown>>(
  endpoint: string,
  data: unknown,
  options: Omit<RequestInit, 'headers' | 'method' | 'body'> = {}
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    ...options,
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(formatErrorMessage(json.error || `Request to ${endpoint} failed with HTTP ${res.status}.`));
  }
  return json as T;
}

/**
 * Runs one streamed chat turn on the server and returns the assistant's reply
 * and any tool calls it requested.
 *
 * The reply is NDJSON: `{ delta }` lines with each new piece of text, then one
 * `{ done, chatId, text, functionCalls }` line, or an `{ error }` line.
 */
export async function streamChat(
  endpoint: string,
  data: unknown,
  { onText, ...options }: Omit<RequestInit, 'headers'> & { onText?: (text: string) => void } = {}
): Promise<ChatTurnResponse> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${endpoint}`, {
      ...options,
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new UserFacingError(
      'Please make sure the service is running, or enable the on-device model in Settings.'
    );
  }

  const contentType = res.headers.get('Content-Type') || '';
  if (!res.ok || !res.body || contentType.includes('application/json')) {
    const json = await res.json().catch(() => ({}));
    // 409: the server no longer has this chat. Its message tells the user
    // what to do, so it is shown as it is.
    if (res.status === 409 && typeof json.error === 'string') throw new UserFacingError(json.error);
    if (json.error) throw new Error(formatErrorMessage(json.error));
    if (!res.ok) throw new Error(`Request to ${endpoint} failed with HTTP ${res.status}.`);
    return json as ChatTurnResponse;
  }

  let fullText = '';
  let finalResult: ChatTurnResponse | undefined;
  let reported: Error | undefined;
  let receivedAnyChunk = false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    const raw = line.trim();
    if (!raw) return;
    receivedAnyChunk = true;
    const chunk = JSON.parse(raw);
    if (chunk.error) {
      reported = new Error(formatErrorMessage(chunk.error));
      throw reported;
    }
    if (typeof chunk.delta === 'string' && chunk.delta) {
      fullText += chunk.delta;
      onText?.(fullText);
    }
    if (chunk.done) {
      // The final line carries the whole reply, which wins over the pieces.
      if (typeof chunk.text === 'string' && chunk.text !== fullText) {
        fullText = chunk.text;
        onText?.(fullText);
      }
      finalResult = {
        ...(chunk.chatId ? { chatId: chunk.chatId } : {}),
        text: fullText,
        functionCalls: chunk.functionCalls ?? [],
      };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split('\n')) {
      if (line.trim()) handleLine(line);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (options.signal?.aborted) throw error;
    if (reported) throw reported;
    throw new UserFacingError(
      'Lost the connection to the AI service. Please make sure the service is running, or enable the on-device model in Settings.'
    );
  }

  if (!receivedAnyChunk) {
    throw new Error('The backend server ended the response early.');
  }

  return finalResult ?? { text: fullText, functionCalls: [] };
}
