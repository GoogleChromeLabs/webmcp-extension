/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../src/services/toolEncoder.js';
import { WebMCPTool } from '../src/types/index.js';

test('buildToolDecls encodes tool names with frame location indices', () => {
  const mockTools: WebMCPTool[] = [
    { name: 'searchHotels', description: 'Search hotels', inputSchema: '{"type":"object"}', location: 'https://example.com/page1' },
    { name: 'filterGym', description: 'Filter by gym', inputSchema: '{"type":"object"}', location: 'https://example.com/page1' },
    { name: 'iframeAction', description: 'Action in iframe', inputSchema: null, location: 'https://iframe.example.com' },
  ];

  const decls = buildToolDecls(mockTools);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, '_0_searchHotels');
  assert.equal(decls[1].name, '_0_filterGym');
  assert.equal(decls[2].name, '_2_iframeAction');
  assert.deepEqual(decls[2].parameters, { type: 'object', properties: {} });
});

test('decodeToolName decodes name and location correctly', () => {
  const mockTools: WebMCPTool[] = [
    { name: 'searchHotels', location: 'https://example.com/page1' },
    { name: 'filterGym', location: 'https://example.com/page1' },
    { name: 'iframeAction', location: 'https://iframe.example.com' },
  ];

  const tool0 = decodeToolName(mockTools, '_0_searchHotels');
  assert.equal(tool0.name, 'searchHotels');
  assert.equal(tool0.location, 'https://example.com/page1');

  const tool2 = decodeToolName(mockTools, '_2_iframeAction');
  assert.equal(tool2.name, 'iframeAction');
  assert.equal(tool2.location, 'https://iframe.example.com');
});

test('decodeToolName falls back gracefully for unencoded names', () => {
  const mockTools: WebMCPTool[] = [];
  const decoded = decodeToolName(mockTools, 'rawToolName');
  assert.equal(decoded.name, 'rawToolName');
  assert.equal(decoded.location, undefined);
});
