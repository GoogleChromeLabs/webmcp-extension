import test from 'node:test';
import assert from 'node:assert/strict';
import { getIframeOrigins } from '../extension/utils.js';

test('getIframeOrigins returns empty array when webNavigation is unavailable', async () => {
  const globalChrome = globalThis.chrome;
  globalThis.chrome = undefined;
  const origins = await getIframeOrigins(1);
  assert.deepEqual(origins, []);
  globalThis.chrome = globalChrome;
});

test('getIframeOrigins extracts unique cross-origin iframe origins', async () => {
  globalThis.chrome = {
    webNavigation: {
      getAllFrames: async ({ tabId }) => [
        { frameId: 0, url: 'https://example.com/main' },
        { frameId: 1, url: 'https://iframe1.example.com/page' },
        { frameId: 2, url: 'https://iframe1.example.com/other' },
        { frameId: 3, url: 'https://iframe2.example.com/page' },
        { frameId: 4, url: 'invalid-url' },
      ],
    },
  };

  const origins = await getIframeOrigins(1);
  assert.deepEqual(origins, [
    'https://iframe1.example.com',
    'https://iframe2.example.com',
  ]);
});
