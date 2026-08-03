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
  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method: data ? 'POST' : 'GET',
    ...(data
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      : {}),
    ...options,
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json as T;
}
