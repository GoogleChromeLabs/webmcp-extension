/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDecls } from '../../extension/sidepanel/services/toolEncoder.js';
import { checkOutputSchema } from '../../extension/sidepanel/services/toolResults.js';
import { type WebMCPTool } from '../../extension/sidepanel/types/index.js';

const WEATHER_TOOL: WebMCPTool = {
  name: 'get_weather',
  description: 'Gets the weather.',
  outputSchema: {
    type: 'object',
    properties: { temperature: { type: 'number' }, unit: { enum: ['C', 'F'] } },
    required: ['temperature'],
  },
  frameId: 0,
};

test('checkOutputSchema accepts a JSON-serialized result that matches', () => {
  assert.equal(checkOutputSchema(JSON.stringify({ temperature: 21, unit: 'C' }), WEATHER_TOOL), null);
  // Results that were never serialized are checked as they are.
  assert.equal(checkOutputSchema({ temperature: 21 }, WEATHER_TOOL), null);
});

test('checkOutputSchema says where a result breaks its schema', () => {
  const wrongType = checkOutputSchema(JSON.stringify({ temperature: 'warm' }), WEATHER_TOOL);
  assert.match(wrongType ?? '', /does not match the tool's output schema/);
  assert.match(wrongType ?? '', /#\/temperature/);

  const missing = checkOutputSchema(JSON.stringify({ unit: 'C' }), WEATHER_TOOL);
  assert.match(missing ?? '', /temperature/);

  // Text that is not JSON is checked as a string, which an object schema refuses.
  assert.match(checkOutputSchema('It is warm.', WEATHER_TOOL) ?? '', /does not match/);
});

test('checkOutputSchema checks plain text results against a string schema', () => {
  const tool: WebMCPTool = { name: 'greet', outputSchema: { type: 'string' }, frameId: 0 };
  assert.equal(checkOutputSchema('Hello!', tool), null);
  assert.equal(checkOutputSchema(JSON.stringify('Hello!'), tool), null);
  assert.match(checkOutputSchema(JSON.stringify(42), tool) ?? '', /does not match/);
});

test('checkOutputSchema lets results through when there is nothing to check against', () => {
  const noSchema: WebMCPTool = { name: 'no_schema', frameId: 0 };
  assert.equal(checkOutputSchema('anything', noSchema), null);
  assert.equal(checkOutputSchema('anything', undefined), null);

  const notASchema = { name: 'odd', outputSchema: ['not', 'a', 'schema'], frameId: 0 } as unknown as WebMCPTool;
  assert.equal(checkOutputSchema('anything', notASchema), null);
});

test('checkOutputSchema reports a few violations, not all of them', () => {
  const tool: WebMCPTool = {
    name: 'many',
    outputSchema: { type: 'array', items: { type: 'number' } },
    frameId: 0,
  };
  const message = checkOutputSchema(JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']), tool) ?? '';
  assert.match(message, /does not match/);
  assert.ok(message.length < 600, `kept short, got ${message.length} chars`);
});

test('buildToolDecls does not send the output schema to the model', () => {
  const [decl] = buildToolDecls([WEATHER_TOOL]);
  assert.deepEqual(decl, {
    name: '_0_get_weather',
    description: 'Gets the weather.',
    parameters: { type: 'object', properties: {} },
  });
});
