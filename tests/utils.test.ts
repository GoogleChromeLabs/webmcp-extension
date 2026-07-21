/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getIframeOrigins } from '../extension/utils.js';

test('getIframeOrigins returns empty array when webNavigation is unavailable', async () => {
  const origins = await getIframeOrigins(123);
  assert.deepEqual(origins, []);
});

test('getIframeOrigins extracts unique cross-origin iframe origins', async () => {
  globalThis.chrome = {
    webNavigation: {
      getAllFrames: async () => [
        { frameId: 0, url: 'https://parent.example.com' },
        { frameId: 1, url: 'https://iframe1.example.com/page' },
        { frameId: 2, url: 'https://iframe2.example.com/page' },
        { frameId: 3, url: 'https://iframe1.example.com/another' },
      ],
    },
  } as unknown as typeof chrome;

  const origins = await getIframeOrigins(123);
  assert.deepEqual(origins, ['https://iframe1.example.com', 'https://iframe2.example.com']);

  delete (globalThis as { chrome?: unknown }).chrome;
});
