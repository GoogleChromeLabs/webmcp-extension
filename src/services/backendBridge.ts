/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const SERVER_URL = 'http://localhost:3000';

let runtimeAuthToken: string | null = null;

/**
 * Explicitly sets or overrides the WebMCP auth token in memory.
 */
export function setAuthToken(token: string | null): void {
  runtimeAuthToken = token;
}

/**
 * Retrieves the active WebMCP auth token.
 * At build time, esbuild statically replaces `process.env.WEBMCP_AUTH_TOKEN`
 * with the string literal token from .env.
 */
export function getAuthToken(): string {
  if (runtimeAuthToken !== null) {
    return runtimeAuthToken;
  }
  const buildToken = process.env.WEBMCP_AUTH_TOKEN;
  if (buildToken) {
    return buildToken;
  }
  return '';
}


/**
 * Utility for making API requests to the backend Gemini model routing server.
 */
export async function callBackend<T = unknown>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(data ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'X-WebMCP-Auth': token } : {}),
  };

  if (options.headers) {
    if (typeof Headers !== 'undefined' && options.headers instanceof Headers) {
      options.headers.forEach((val, key) => {
        headers[key] = val;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, val] of options.headers) {
        headers[key] = val;
      }
    } else {
      Object.assign(headers, options.headers);
    }
  }

  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method: data ? 'POST' : 'GET',
    headers,
    ...(data ? { body: JSON.stringify(data) } : {}),
    ...options,
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json as T;
}

