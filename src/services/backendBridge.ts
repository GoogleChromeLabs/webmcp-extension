/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const SERVER_URL = 'http://localhost:3000';

/**
 * Utility for making API requests to the backend Gemini model routing server.
 */
export async function callBackend<T = unknown>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const { headers, ...restOptions } = options;
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method: data ? 'POST' : 'GET',
    headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(headers as Record<string, string>),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    ...restOptions,
  });

  let json: { error?: string } = {};
  try {
    json = await res.json();
  } catch {
    if (res.ok === false || (res.status && (res.status < 200 || res.status >= 300))) {
      throw new Error(`HTTP error ${res.status || 'unknown'}: ${res.statusText || 'Server error'}`);
    }
  }

  if (json.error) {
    throw new Error(json.error);
  }
  if (res.ok === false || (res.status && (res.status < 200 || res.status >= 300))) {
    throw new Error(`Server returned status ${res.status}`);
  }
  return json as T;
}
