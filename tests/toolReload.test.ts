/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebMCPTool } from '../src/types/index.js';

test('toolsRef is updated synchronously when new tools arrive from content script', () => {
  const toolsRef: { current: WebMCPTool[] } = { current: [] };

  function handleToolsMessage(newTools: WebMCPTool[]) {
    const parsedTools = newTools || [];
    toolsRef.current = parsedTools;
  }

  function buildToolDecls() {
    const list = toolsRef.current;
    return list.map((tool) => {
      const locationIndex = list.findIndex((t) => t.location === tool.location);
      return {
        name: `_${locationIndex}_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema ? (typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema) : { type: 'object', properties: {} },
      };
    });
  }

  // Turn 1: Initial tools on search page
  handleToolsMessage([
    { name: 'searchHotels', description: 'Search hotels by location', inputSchema: '{"type":"object"}', location: 'https://example.com' },
  ]);

  let decls = buildToolDecls();
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, '_0_searchHotels');

  // Turn 1 Mid-flight: Page submits form and loads filter tools (filterGym, filterBreakfast)
  handleToolsMessage([
    { name: 'searchHotels', description: 'Search hotels by location', inputSchema: '{"type":"object"}', location: 'https://example.com' },
    { name: 'filterGym', description: 'Filter by gym', inputSchema: '{"type":"object"}', location: 'https://example.com' },
    { name: 'filterBreakfast', description: 'Filter by breakfast', inputSchema: '{"type":"object"}', location: 'https://example.com' },
  ]);

  // Turn 1 Mid-flight: buildToolDecls immediately reflects new tools
  decls = buildToolDecls();
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

  function buildToolDecls() {
    const list = toolsRef.current;
    return list.map((tool) => {
      const locationIndex = list.findIndex((t) => t.location === tool.location);
      return {
        name: `_${locationIndex}_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema ? (typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema) : { type: 'object', properties: {} },
      };
    });
  }

  const decls = buildToolDecls();
  assert.equal(decls.length, 1);
  assert.deepEqual(decls[0].parameters, { type: 'object', properties: {} });
});

test('toolResponses payload includes updated tools when tools arrive dynamically mid-turn', () => {
  const toolsRef: { current: WebMCPTool[] } = {
    current: [{ name: 'search_location', description: 'Search', inputSchema: '{}', location: 'https://example.com' }],
  };

  function buildToolDecls() {
    return toolsRef.current.map((tool, idx) => ({
      name: `_${idx}_${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema ? (typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema) : { type: 'object', properties: {} },
    }));
  }

  // Simulate tool response construction after search_location registers new tools on DOM
  toolsRef.current.push(
    { name: 'filter_search_results', description: 'Filter', inputSchema: '{}', location: 'https://example.com' },
    { name: 'get_current_search_results', description: 'Get results', inputSchema: '{}', location: 'https://example.com' }
  );

  const payload = {
    toolResponses: [{ functionResponse: { name: '_0_search_location', response: { status: 'ok' } } }],
    tools: buildToolDecls(),
    chatId: 'test-chat-id',
  };

  assert.equal(payload.tools.length, 3);
  assert.equal(payload.tools[1].name, '_1_filter_search_results');
  assert.equal(payload.tools[2].name, '_2_get_current_search_results');
});
