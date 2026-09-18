/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTools } from '../server/tools.js';

test('buildTools declares the page tools, and leaves them without an execute', () => {
  const tools = buildTools([
    { name: 'book_table', description: 'Books a table', parameters: { type: 'object', properties: { size: { type: 'number' } } } },
    // A page may send its schema as a string, or under the newer name.
    { name: 'search', description: 'Searches', inputSchema: '{"type":"object","properties":{"q":{"type":"string"}}}' },
    { name: 'broken', parameters: 'not json' },
    { name: 'bare' },
    // Nothing usable: no name at all.
    { description: 'Nameless' },
  ]);

  assert.deepEqual(Object.keys(tools), ['book_table', 'search', 'broken', 'bare']);
  // No `execute`, so the model asking for a tool ends the turn instead of the
  // SDK running it here.
  for (const declared of Object.values(tools) as any[]) {
    assert.equal(declared.execute, undefined);
  }

  assert.deepEqual((tools as any).book_table.inputSchema.jsonSchema, {
    type: 'object',
    properties: { size: { type: 'number' } },
  });
  assert.deepEqual((tools as any).search.inputSchema.jsonSchema, {
    type: 'object',
    properties: { q: { type: 'string' } },
  });
  // A schema that will not parse, and a tool that declared none at all, both
  // fall back to an empty object rather than failing the whole turn.
  const empty = { type: 'object', properties: {} };
  assert.deepEqual((tools as any).broken.inputSchema.jsonSchema, empty);
  assert.deepEqual((tools as any).bare.inputSchema.jsonSchema, empty);
  assert.equal((tools as any).bare.description, '');
});

test('buildTools handles null, non-array inputs, and non-object schemas gracefully', () => {
  assert.deepEqual(buildTools(null as any), {});
  assert.deepEqual(buildTools({} as any), {});
  assert.deepEqual(buildTools(undefined), {});

  const tools = buildTools([
    { name: 'num_schema', parameters: 42 as any },
    { name: 'bool_schema', parameters: true as any },
    { name: 'arr_schema', parameters: ['not-an-object'] as any },
    { name: 'empty_obj', parameters: {} },
    { name: 'no_type', parameters: { properties: { q: { type: 'string' } } } },
  ]);

  const empty = { type: 'object', properties: {} };
  assert.deepEqual((tools as any).num_schema.inputSchema.jsonSchema, empty);
  assert.deepEqual((tools as any).bool_schema.inputSchema.jsonSchema, empty);
  assert.deepEqual((tools as any).arr_schema.inputSchema.jsonSchema, empty);
  assert.deepEqual((tools as any).empty_obj.inputSchema.jsonSchema, empty);
  assert.deepEqual((tools as any).no_type.inputSchema.jsonSchema, {
    type: 'object',
    properties: { q: { type: 'string' } },
  });
});
