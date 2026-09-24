/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { ToolCallPart } from 'ai';
import { appendTurnMessages, buildTools, hasPendingToolCalls } from '../server/tools.js';

test('buildTools declares the page tools, and leaves them without an execute', () => {
  const tools = buildTools([
    { name: 'book_table', description: 'Books a table', parameters: { type: 'object', properties: { size: { type: 'number' } } } },
    // Only a missing `type` is filled in.
    { name: 'search', description: 'Searches', parameters: { properties: { q: { type: 'string' } } } },
    // A string is not a schema: the side panel parses schemas before sending.
    { name: 'broken', parameters: '{"type":"object"}' as any },
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
  // A schema that is not an object, and a tool that declared none at all, both
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

test('hasPendingToolCalls is true only while the last assistant message waits on a tool call', () => {
  const call: ToolCallPart = { type: 'tool-call', toolCallId: 'c1', toolName: 'search', input: {} };
  assert.equal(hasPendingToolCalls([]), false);
  assert.equal(hasPendingToolCalls([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]), false);
  assert.equal(hasPendingToolCalls([{ role: 'assistant', content: [call] }]), true);

  // Once answered, nothing is pending any more.
  const answered = appendTurnMessages([{ role: 'assistant', content: [call] }], {
    toolResponses: [{ functionResponse: { id: 'c1', name: 'search', response: { result: 'ok' } } }],
  });
  assert.equal(hasPendingToolCalls(answered), false);
});
