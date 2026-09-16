/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const SERVER_URL = 'http://localhost:3000';

/**
 * Retrieves the active WebMCP auth token.
 * At build time, esbuild statically replaces `process.env.WEBMCP_AUTH_TOKEN`
 * with the string literal token from .env.
 */
export function getAuthToken(): string {
  return process.env.WEBMCP_AUTH_TOKEN || '';
}


/**
 * The headers every request to the backend server carries, on top of the
 * caller's. The content type and the auth token are set last, so a caller
 * cannot drop the token or send a body the server will not parse. `Headers`
 * takes care of the caller's own, in whatever shape, and of header names
 * differing only in case.
 */
function buildHeaders(data: unknown, extra: RequestInit['headers']): Headers {
  const headers = new Headers(extra);
  if (data) headers.set('Content-Type', 'application/json');
  const token = getAuthToken();
  if (token) headers.set('X-WebMCP-Auth', token);
  return headers;
}

/**
 * Utility for making API requests to the backend Gemini model routing server.
 */
export async function callBackend<T = unknown>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  // The caller's options first: what this sets is not theirs to replace.
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    ...options,
    method: options.method ?? (data ? 'POST' : 'GET'),
    headers: buildHeaders(data, options.headers),
    ...(data ? { body: JSON.stringify(data) } : {}),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json as T;
}

/**
 * Like callBackend(), for an endpoint that streams newline-delimited JSON:
 * `{ text }` lines as the response is written, then a `{ done: true }` line
 * with the whole payload, which is what this resolves with. `onText` is
 * called with the text so far on every `{ text }` line. An `{ error }` line,
 * or a plain JSON error when the server refused before streaming, rejects.
 */
export async function streamBackend<T = unknown>(
  endpoint: string,
  data: unknown,
  { onText, ...options }: RequestInit & { onText?: (text: string) => void } = {}
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    ...options,
    method: 'POST',
    headers: buildHeaders(data, options.headers),
    body: JSON.stringify(data),
  });

  if (!res.body || !res.headers.get('Content-Type')?.includes('ndjson')) {
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json as T;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.error) throw new Error(message.error);
      if (message.done) {
        const { done: _done, ...payload } = message;
        return payload as T;
      }
      if (typeof message.text === 'string') {
        text += message.text;
        onText?.(text);
      }
    }
    if (done) throw new Error('The backend server ended the response early.');
  }
}
