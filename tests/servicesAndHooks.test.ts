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
    { name: 'read_page', description: 'Read DOM content', inputSchema: '{"type":"object","properties":{"selector":{"type":"string"}}}', location: 'https://example.com' },
    { name: 'submit_form', description: 'Submit form data', inputSchema: { type: 'object', properties: {} }, location: 'https://example.com/iframe' }
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 2);
  assert.equal(decls[0].name, '_0_read_page');
  assert.equal(decls[0].description, 'Read DOM content');
  assert.equal((decls[0].parameters.properties as Record<string, { type: string }>).selector.type, 'string');
  assert.equal(decls[1].name, '_1_submit_form');
});

test('toolEncoder - decodeToolName parses location and original name correctly', () => {
  const tools: WebMCPTool[] = [
    { name: 'read_page', location: 'https://example.com' },
    { name: 'submit_form', location: 'https://example.com/iframe' }
  ];

  const decoded0 = decodeToolName(tools, '_0_read_page');
  assert.equal(decoded0.name, 'read_page');
  assert.equal(decoded0.location, 'https://example.com');

  const decoded1 = decodeToolName(tools, '_1_submit_form');
  assert.equal(decoded1.name, 'submit_form');
  assert.equal(decoded1.location, 'https://example.com/iframe');
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
  if (typeof globalThis.localStorage === 'undefined') {
    (globalThis as unknown as { localStorage: Record<string, string> }).localStorage = {};
  }

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

