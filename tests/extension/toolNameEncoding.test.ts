/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls, decodeToolName } from '../../extension/sidepanel/services/toolEncoder.js';
import { type WebMCPTool } from '../../extension/sidepanel/types/index.js';

test('buildToolDecls encodes tool names with frameIDs', () => {
  const mockTools: WebMCPTool[] = [
    { name: 'searchHotels', description: 'Search hotels', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'filterGym', description: 'Filter by gym', inputSchema: '{"type":"object"}', frameId: 0 },
    { name: 'iframeAction', description: 'Action in iframe', inputSchema: null, frameId: 2 },
  ];

  const decls = buildToolDecls(mockTools);
  assert.equal(decls.length, 3);
  assert.equal(decls[0].name, 'f0_search_hotels');
  assert.equal(decls[1].name, 'f0_filter_gym');
  assert.equal(decls[2].name, 'f2_iframe_action');
  assert.deepEqual(decls[2].parameters, { type: 'object', properties: {} });
});

test('decodeToolName decodes name and frameID correctly', () => {
  const tool0 = decodeToolName('f0_search_hotels');
  assert.equal(tool0.name, 'searchHotels');
  assert.equal(tool0.frameId, 0);

  const tool2 = decodeToolName('f2_iframe_action');
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
  assert.equal(decls[0].name, 'f1_direct__object__tool');
  assert.deepEqual(decls[0].parameters, { type: 'object', properties: { count: { type: 'number' } } });
});

test('decodeToolName handles empty or missing inputs gracefully', () => {
  assert.deepEqual(decodeToolName(''), { name: '', frameId: undefined });
  assert.deepEqual(decodeToolName(), { name: '', frameId: undefined });
});

test('a declared name never carries an uppercase letter, which crashes the on-device model', () => {
  const tools: WebMCPTool[] = [
    { name: 'searchHotels', description: '', inputSchema: null, frameId: 0 },
    { name: 'OpenDoor1', description: '', inputSchema: null, frameId: 0 },
    { name: 'XMLRequest', description: '', inputSchema: null, frameId: 3 },
  ];

  for (const decl of buildToolDecls(tools)) {
    assert.match(decl.name, /^[a-z0-9_]+$/, `${decl.name} would crash the on-device model`);
  }
});

test('a folded name leads back to the name the page declared', () => {
  const names = [
    'searchHotels',
    'open_door1',
    'openDoor1',
    'XMLRequest',
    '_private',
    'trailing_',
    'ALLCAPS',
    'already_snake_case',
    'mixed_Case_With_1Digit',
  ];
  const tools: WebMCPTool[] = names.map((name) => ({
    name,
    description: '',
    inputSchema: null,
    frameId: 1,
  }));

  const decls = buildToolDecls(tools);
  for (const [index, decl] of decls.entries()) {
    assert.deepEqual(decodeToolName(decl.name), { name: names[index], frameId: 1 });
  }
});

test('folding keeps two tools apart that differ only in case', () => {
  const tools: WebMCPTool[] = [
    { name: 'openDoor', description: '', inputSchema: null, frameId: 0 },
    { name: 'open_door', description: '', inputSchema: null, frameId: 0 },
    { name: 'opendoor', description: '', inputSchema: null, frameId: 0 },
  ];

  const declared = buildToolDecls(tools).map((decl) => decl.name);
  assert.equal(new Set(declared).size, 3);
  assert.deepEqual(declared, ['f0_open_door', 'f0_open__door', 'f0_opendoor']);
});
