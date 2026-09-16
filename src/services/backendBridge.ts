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

/**
 * Utility for making API requests to the backend Gemini model routing server.
 *
 * `headers` is deliberately excluded from `options`: this function owns the
 * auth token and Content-Type headers, and merging caller-supplied ones is
 * case-sensitive, so a caller passing `x-webmcp-auth` would produce a second
 * header rather than replacing ours. fetch joins duplicates with a comma and
 * the server then rejects the request. Excluding it makes that a type error.
 */
export async function callBackend<T = unknown>(
  endpoint: string,
  data?: unknown,
  options: Omit<RequestInit, 'headers'> = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(data ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'X-WebMCP-Auth': token } : {}),
  };

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
      headers,
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

