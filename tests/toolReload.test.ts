/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../src/services/toolEncoder.js';
import { executeTabTool } from '../src/services/extensionBridge.js';
import { WebMCPTool } from '../src/types/index.js';

test('toolEncoder - resolves same-name tools across multiple frames without collision', () => {
  const tools: WebMCPTool[] = [
    { name: 'submit_form', description: 'Main frame form', inputSchema: '{}', frameId: 0 },
    { name: 'submit_form', description: 'Iframe 1 form', inputSchema: '{}', frameId: 1 },
    { name: 'submit_form', description: 'Iframe 2 form', inputSchema: '{}', frameId: 2 },
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, '_0_submit_form');
  assert.equal(decls[1].name, '_1_submit_form');
  assert.equal(decls[2].name, '_2_submit_form');

  // Verify all 3 decode back to their exact respective frames
  const decoded0 = decodeToolName(decls[0].name);
  const decoded1 = decodeToolName(decls[1].name);
  const decoded2 = decodeToolName(decls[2].name);

  assert.equal(decoded0.frameId, 0);
  assert.equal(decoded0.name, 'submit_form');
  assert.equal(decoded1.frameId, 1);
  assert.equal(decoded1.name, 'submit_form');
  assert.equal(decoded2.frameId, 2);
  assert.equal(decoded2.name, 'submit_form');
});

test('toolEncoder - handles dynamic tool list transitions as page updates DOM tools', () => {
  let activeTools: WebMCPTool[] = [
    { name: 'searchHotels', description: 'Search', inputSchema: '{"type":"object"}', frameId: 0 },
  ];

  let decls = buildToolDecls(activeTools);
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, '_0_searchHotels');

  // Page navigates to results and adds filters and pagination tools
  activeTools = [
    { name: 'searchHotels', description: 'Search', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'applyFilter', description: 'Filter', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'nextPage', description: 'Next page', inputSchema: '{"type":"object"}', frameId: 0 },
  ];

  decls = buildToolDecls(activeTools);
  assert.equal(decls.length, 3);
  assert.equal(decls[1].name, '_0_applyFilter');
  assert.equal(decls[2].name, '_0_nextPage');
});

test('executeTabTool recovers and fetches cross-document result when tool triggers navigation', async () => {
  const sentMessages: Array<{ message: unknown }> = [];
  const origChrome = globalThis.chrome;

  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 10, url: 'https://example.com' } as chrome.tabs.Tab],
      get: async () => ({ id: 10, status: 'complete' } as chrome.tabs.Tab),
      sendMessage: async (_tabId: number, message: unknown) => {
        sentMessages.push({ message });
        const msg = message as { action: string };
        if (msg.action === 'EXECUTE_TOOL') {
          // Simulate navigation closing the channel
          throw new Error('message channel is closed');
        }
        if (msg.action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') {
          return { navigated: true, page: 'confirmation' };
        }
        return null;
      },
      onUpdated: {
        addListener: (cb: (tabId: number, changeInfo: { status: string }) => void) => {
          // Immediately simulate tab completion
          setTimeout(() => cb(10, { status: 'complete' }), 10);
        },
        removeListener: () => {},
      },
    } as unknown as typeof chrome.tabs,
    runtime: {
      onMessage: {
        addListener: (listener: (msg: unknown, sender: unknown) => void) => {
          setTimeout(() => {
            listener({ type: 'contentScriptReady' }, { tab: { id: 10 } });
            listener({ tools: [] }, { tab: { id: 10 } });
          }, 5);
        },
        removeListener: () => {},
      },
    } as unknown as typeof chrome.runtime,
  } as typeof chrome;

  try {
    const result = await executeTabTool('navigate_to_checkout', {}, 0, 10);
    assert.deepEqual(result, { navigated: true, page: 'confirmation' });
    assert.equal(sentMessages.length, 2);
    assert.equal((sentMessages[0].message as { action: string }).action, 'EXECUTE_TOOL');
    assert.equal((sentMessages[1].message as { action: string }).action, 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT');
  } finally {
    globalThis.chrome = origChrome;
  }
});

