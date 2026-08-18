/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls } from '../src/services/toolEncoder.js';
import { WebMCPTool } from '../src/types/index.js';

test('toolsRef is updated synchronously when new tools arrive from content script', () => {
  const toolsRef: { current: WebMCPTool[] } = { current: [] };

  function handleToolsMessage(newTools: WebMCPTool[]) {
    const parsedTools = newTools || [];
    toolsRef.current = parsedTools;
  }

  // Turn 1: Initial tools on search page
  handleToolsMessage([
    { name: 'searchHotels', description: 'Search hotels by location', inputSchema: '{"type":"object"}', location: 'https://example.com' },
  ]);

  let decls = buildToolDecls(toolsRef.current);
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, '_0_searchHotels');

  // Turn 1 Mid-flight: Page submits form and loads filter tools (filterGym, filterBreakfast)
  handleToolsMessage([
    { name: 'searchHotels', description: 'Search hotels by location', inputSchema: '{"type":"object"}', location: 'https://example.com' },
    { name: 'filterGym', description: 'Filter by gym', inputSchema: '{"type":"object"}', location: 'https://example.com' },
    { name: 'filterBreakfast', description: 'Filter by breakfast', inputSchema: '{"type":"object"}', location: 'https://example.com' },
  ]);

  // Turn 1 Mid-flight: buildToolDecls immediately reflects new tools
  decls = buildToolDecls(toolsRef.current);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, '_0_searchHotels');
  assert.equal(decls[1].name, '_0_filterGym');
  assert.equal(decls[2].name, '_0_filterBreakfast');
});

test('buildToolDecls handles null/missing inputSchema gracefully', () => {
  const toolsRef: { current: WebMCPTool[] } = {
    current: [
      { name: 'simpleAction', description: 'No args action', inputSchema: null, location: 'https://example.com' },
    ],
  };

  const decls = buildToolDecls(toolsRef.current);
  assert.equal(decls.length, 1);
  assert.deepEqual(decls[0].parameters, { type: 'object', properties: {} });
});

test('toolResponses payload includes updated tools when tools arrive dynamically mid-turn', () => {
  const toolsRef: { current: WebMCPTool[] } = {
    current: [{ name: 'search_location', description: 'Search', inputSchema: '{}', location: 'https://example.com' }],
  };

  // Simulate tool response construction after search_location registers new tools on DOM and in an iframe
  toolsRef.current.push(
    { name: 'filter_search_results', description: 'Filter', inputSchema: '{}', location: 'https://example.com' },
    { name: 'get_iframe_details', description: 'Get details', inputSchema: '{}', location: 'https://iframe.example.com' }
  );

  const payload = {
    toolResponses: [{ functionResponse: { name: '_0_search_location', response: { status: 'ok' } } }],
    tools: buildToolDecls(toolsRef.current),
    chatId: 'test-chat-id',
  };

  assert.equal(payload.tools.length, 3);
  assert.equal(payload.tools[0].name, '_0_search_location');
  assert.equal(payload.tools[1].name, '_0_filter_search_results');
  assert.equal(payload.tools[2].name, '_2_get_iframe_details');
});
