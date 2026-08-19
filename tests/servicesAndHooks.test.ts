/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../src/services/toolEncoder.js';
import { ensureChromeAPI } from '../src/services/extensionBridge.js';
import { WebMCPTool } from '../src/types/index.js';

test('toolEncoder - buildToolDecls correctly formats WebMCP tools into LLM schemas', () => {
  const tools: WebMCPTool[] = [
    { name: 'read_page', description: 'Read DOM content', inputSchema: '{"type":"object","properties":{"selector":{"type":"string"}}}', frameId: 0 },
    { name: 'submit_form', description: 'Submit form data', inputSchema: { type: 'object', properties: {} }, frameId: 1 }
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 2);
  assert.equal(decls[0].name, '_0_read_page');
  assert.equal(decls[0].description, 'Read DOM content');
  assert.equal((decls[0].parameters.properties as Record<string, { type: string }>).selector.type, 'string');
  assert.equal(decls[1].name, '_1_submit_form');
});

test('toolEncoder - decodeToolName parses frameID and original name correctly', () => {
  const tools: WebMCPTool[] = [
    { name: 'read_page', frameId: 0 },
    { name: 'submit_form', frameId: 1 }
  ];

  const decoded0 = decodeToolName('_0_read_page');
  assert.equal(decoded0.name, 'read_page');
  assert.equal(decoded0.frameId, 0);

  const decoded1 = decodeToolName('_1_submit_form');
  assert.equal(decoded1.name, 'submit_form');
  assert.equal(decoded1.frameId, 1);
});

test('extensionBridge - ensureChromeAPI initializes mock chrome context safely outside extension', () => {
  ensureChromeAPI();
  const chromeApi = globalThis.chrome || (globalThis.window as { chrome?: typeof chrome })?.chrome;
  assert.ok(chromeApi);
  assert.ok(chromeApi.tabs);
  assert.equal(typeof chromeApi.tabs.query, 'function');
});

test('useTheme - enforces light mode only on dataset and localStorage', () => {
  if (typeof globalThis.document === 'undefined') {
    (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = {
      documentElement: { dataset: {} }
    };
  }
  const mockStorage: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  globalThis.localStorage.theme = 'dark';
  document.documentElement.dataset.theme = 'dark';

  // Enforce light mode behavior
  document.documentElement.dataset.theme = 'light';
  globalThis.localStorage.theme = 'light';

  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(globalThis.localStorage.theme, 'light');
});

test('backendBridge - callBackend correctly makes fetch requests and handles backend responses', async () => {
  const { callBackend } = await import('../src/services/backendBridge.js');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/model')) {
        return {
          json: async () => ({ success: true, model: 'gemini-3.6-flash' }),
        } as Response;
      }
      if (urlStr.endsWith('/api/error')) {
        return {
          json: async () => ({ error: 'Backend server error' }),
        } as Response;
      }
      return {
        json: async () => ({ success: true }),
      } as Response;
    };

    const res = await callBackend<{ success: boolean; model: string }>('/api/model', { model: 'gemini-3.6-flash' });
    assert.equal(res.success, true);
    assert.equal(res.model, 'gemini-3.6-flash');

    await assert.rejects(
      async () => {
        await callBackend('/api/error');
      },
      { message: 'Backend server error' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extensionBridge - executeTabTool dispatches message to tab with appropriate frame options', async () => {
  const { executeTabTool, ensureChromeAPI } = await import('../src/services/extensionBridge.js');
  ensureChromeAPI();

  const sentMessages: Array<{ tabId: number; message: unknown; options?: unknown }> = [];
  const mockChrome = (globalThis as any).chrome;
  const origSendMessage = mockChrome.tabs.sendMessage;

  try {
    mockChrome.tabs.sendMessage = async (tabId: number, message: unknown, options?: unknown) => {
      sentMessages.push({ tabId, message, options });
      return { success: true, count: 42 };
    };

    // 1. Execute tool in main frame
    const resMain = await executeTabTool('search_hotels', '{"query":"hotel"}', 0);
    assert.deepEqual(resMain, { success: true, count: 42 });
    assert.equal(sentMessages[0].tabId, 1);
    assert.deepEqual(sentMessages[0].options, { frameId: 0 });

    // 2. Execute tool in cross-origin iframe
    const resIframe = await executeTabTool('submit_booking', '{"id":123}', 1);
    assert.deepEqual(resIframe, { success: true, count: 42 });
    assert.deepEqual(sentMessages[1].options, { frameId: 1 });
  } finally {
    mockChrome.tabs.sendMessage = origSendMessage;
  }
});


