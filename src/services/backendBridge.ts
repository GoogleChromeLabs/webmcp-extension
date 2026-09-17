/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base URL of the companion server.
 * At build time, esbuild statically replaces `process.env.WEBMCP_SERVER_URL`
 * with a literal derived from PORT in .env, so a non-default port still works.
 */
const SERVER_URL = process.env.WEBMCP_SERVER_URL || 'http://localhost:3000';

/** How long to wait for the backend before giving up, in milliseconds. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Retrieves the active WebMCP auth token.
 * At build time, esbuild statically replaces `process.env.WEBMCP_AUTH_TOKEN`
 * with the string literal token from .env.
 */
export function getAuthToken(): string {
  return process.env.WEBMCP_AUTH_TOKEN || '';
}

/** The headers every request to the backend server carries. */
function buildHeaders(data: unknown): Headers {
  const headers = new Headers();
  if (data) headers.set('Content-Type', 'application/json');
  const token = getAuthToken();
  if (token) headers.set('X-WebMCP-Auth', token);
  return headers;
}

/**
 * Utility for making API requests to the backend Gemini model routing server.
 *
 * `headers` is deliberately excluded from `options`, here and on
 * streamBackend(): this function owns the auth token and Content-Type
 * headers, and merging caller-supplied ones is case-sensitive, so a caller
 * passing `x-webmcp-auth` would produce a second header rather than replacing
 * ours. fetch joins duplicates with a comma and the server then rejects the
 * request. Excluding it makes that a type error.
 */
export async function callBackend<T = unknown>(
  endpoint: string,
  data?: unknown,
  options: Omit<RequestInit, 'headers'> = {}
): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${endpoint}`, {
      method: data ? 'POST' : 'GET',
      ...(data ? { body: JSON.stringify(data) } : {}),
      ...options,
      headers: buildHeaders(data),
      signal,
    });
  } catch (error) {
    // A caller-initiated cancellation must stay recognisable to the caller
    // (name === 'AbortError'); do not rewrite it as a connection failure.
    if (options.signal?.aborted) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        `Request to ${endpoint} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
      );
    }
    throw new Error(
      `Could not reach the WebMCP server at ${SERVER_URL}. Is it running?`
    );
  }

  let json: { error?: string } & Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      `Server returned a non-JSON response for ${endpoint} (HTTP ${res.status}).`
    );
  }

  if (json.error) {
    throw new Error(json.error);
  }
  if (!res.ok) {
    throw new Error(`Request to ${endpoint} failed with HTTP ${res.status}.`);
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
  { onText, ...options }: Omit<RequestInit, 'headers'> & { onText?: (text: string) => void } = {}
): Promise<T> {
  // No timeout on the request itself, unlike callBackend(): a streamed turn
  // can take as long as the model keeps writing, and a caller that stops it
  // aborts the signal.
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${endpoint}`, {
      ...options,
      method: 'POST',
      headers: buildHeaders(data),
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(`Could not reach the WebMCP server at ${SERVER_URL}. Is it running?`);
  }

  if (!res.body || !res.headers.get('Content-Type')?.includes('ndjson')) {
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json as T;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch (error) {
      // A caller-initiated cancellation must stay recognisable to the caller
      // (name === 'AbortError'); do not rewrite it as a connection failure.
      if (options.signal?.aborted) throw error;
      throw new Error(`Lost the connection to the WebMCP server at ${SERVER_URL}.`);
    }
    const { value, done } = chunk;
    if (value) buffer += value;

    // A piece is only a line once the newline that ends it has arrived. What
    // is left when the response ends is a line the server never finished
    // writing, and reading it as one would fail as a parse error.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let message: { error?: string; done?: boolean; text?: string };
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`The backend server sent a line that is not JSON: ${line.slice(0, 100)}`);
      }
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
