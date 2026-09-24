/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../src/sidepanel/services/toolEncoder.js';
import { WebMCPTool } from '../src/sidepanel/types/index.js';

test('buildToolDecls encodes tool names with frameIDs', () => {
  const mockTools: WebMCPTool[] = [
    { name: 'searchHotels', description: 'Search hotels', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'filterGym', description: 'Filter by gym', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'iframeAction', description: 'Action in iframe', inputSchema: null, frameId: 2 },
  ];

  const decls = buildToolDecls(mockTools);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, '_0_searchHotels');
  assert.equal(decls[1].name, '_0_filterGym');
  assert.equal(decls[2].name, '_2_iframeAction');
  assert.deepEqual(decls[2].parameters, { type: 'object', properties: {} });
});

test('decodeToolName decodes name and frameID correctly', () => {
  const tool0 = decodeToolName('_0_searchHotels');
  assert.equal(tool0.name, 'searchHotels');
  assert.equal(tool0.frameId, 0);

  const tool2 = decodeToolName('_2_iframeAction');
  assert.equal(tool2.name, 'iframeAction');
  assert.equal(tool2.frameId, 2);
});

test('decodeToolName falls back gracefully for unencoded names', () => {
  const decoded = decodeToolName('rawToolName');
  assert.equal(decoded.name, 'rawToolName');
  assert.equal(decoded.frameId, undefined);
});

test('buildToolDecls handles nested schemas, arrays, and malformed JSON strings gracefully', () => {
  const tools: WebMCPTool[] = [
    {
      name: 'filter_hotels',
      inputSchema: '{"type":"object","properties":{"price":{"type":"number"},"amenities":{"type":"array","items":{"type":"string"}}}}',
      frameId: 0,
    },
    {
      name: 'broken_schema_tool',
      inputSchema: '{ invalid json ...',
      frameId: 0,
    },
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 2);
  assert.equal((decls[0].parameters.properties as Record<string, { type: string }>).amenities.type, 'array');
  // Fallback to empty object schema on invalid JSON without throwing
  assert.deepEqual(decls[1].parameters, { type: 'object', properties: {} });
});
test('buildToolDecls handles empty and object-based schemas', () => {
  assert.deepEqual(buildToolDecls(), []);
  assert.deepEqual(buildToolDecls([]), []);

  const tools: WebMCPTool[] = [
    {
      name: 'direct_object_tool',
      description: 'Tool with object schema',
      inputSchema: { type: 'object', properties: { count: { type: 'number' } } },
      frameId: 1,
    },
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, '_1_direct_object_tool');
  assert.deepEqual(decls[0].parameters, { type: 'object', properties: { count: { type: 'number' } } });
});

test('decodeToolName handles empty or missing inputs gracefully', () => {
  assert.deepEqual(decodeToolName(''), { name: '', frameId: undefined });
  assert.deepEqual(decodeToolName(), { name: '', frameId: undefined });
});
