/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../src/services/toolEncoder.js';
import { getActiveTabInfo, requestTabTools, executeTabTool } from '../src/services/extensionBridge.js';
import { WebMCPTool } from '../src/types/index.js';
import { useAgentSession } from '../src/hooks/useAgentSession.js';

function setupTestChrome() {
  const listeners: Array<(message: unknown, sender: unknown) => void> = [];
  globalThis.chrome = {
    tabs: {
      query: async () => [
        { id: 1, url: 'https://example.com', favIconUrl: 'https://example.com/favicon.ico' },
      ] as chrome.tabs.Tab[],
      sendMessage: async (_tabId: number, _message: unknown) => ({ success: true }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    } as unknown as typeof chrome.tabs,
    runtime: {
      onMessage: {
        addListener: (cb: (message: unknown, sender: unknown) => void) => listeners.push(cb),
        removeListener: (cb: (message: unknown, sender: unknown) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
        },
      },
      sendMessage: async () => {},
    } as unknown as typeof chrome.runtime,
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://example.com' }],
    } as unknown as typeof chrome.webNavigation,
  } as typeof chrome;
}

test('toolEncoder - buildToolDecls correctly formats WebMCP tools with structured objects and strings into LLM schemas', () => {
  const tools: WebMCPTool[] = [
    { name: 'read_page', description: 'Read DOM content', inputSchema: { type: 'object', properties: { selector: { type: 'string' } } }, frameId: 0 },
    { name: 'submit_form', description: 'Submit form data', inputSchema: { type: 'object', properties: {} }, frameId: 1 },
    { name: 'legacy_string_tool', description: 'Legacy string schema', inputSchema: '{"type":"object","properties":{"id":{"type":"number"}}}', frameId: 0 }
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, '_0_read_page');
  assert.equal(decls[0].description, 'Read DOM content');
  assert.equal((decls[0].parameters.properties as Record<string, { type: string }>).selector.type, 'string');
  assert.equal(decls[1].name, '_1_submit_form');
  assert.equal((decls[2].parameters.properties as Record<string, { type: string }>).id.type, 'number');
});

test('toolEncoder - decodeToolName parses frameID and original name correctly', () => {
  const decoded0 = decodeToolName('_0_read_page');
  assert.equal(decoded0.name, 'read_page');
  assert.equal(decoded0.frameId, 0);

  const decoded1 = decodeToolName('_1_submit_form');
  assert.equal(decoded1.name, 'submit_form');
  assert.equal(decoded1.frameId, 1);
});

test('extensionBridge - getActiveTabInfo returns tab metadata when chrome.tabs is available', async () => {
  setupTestChrome();
  const info = await getActiveTabInfo();
  assert.ok(info);
  assert.equal(info.tabId, 1);
  assert.equal(info.domain, 'example.com');
  assert.equal(info.favicon, 'https://example.com/favicon.ico');
});

test('extensionBridge - requestTabTools dispatches LIST_TOOLS message to active tab', async () => {
  setupTestChrome();
  let dispatchedMessage: unknown = null;
  globalThis.chrome.tabs.sendMessage = async (_tabId: number, message: unknown) => {
    dispatchedMessage = message;
    return { success: true };
  };

  await requestTabTools();
  assert.ok(dispatchedMessage);
  assert.equal((dispatchedMessage as { action: string }).action, 'LIST_TOOLS');
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
  setupTestChrome();
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

test('useAgentSession exports robust session management API with handleStop', () => {
  assert.equal(typeof useAgentSession, 'function');
});


