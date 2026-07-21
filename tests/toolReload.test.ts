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
