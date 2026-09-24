/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTokenLimit, MAX_TOOL_RESPONSE_CHARS } from '../src/sidepanel/services/toolResults.js';

test('applyTokenLimit leaves responses under the maximum character limit untouched', () => {
  const shortString = 'Short tool response with normal size data.';
  assert.equal(applyTokenLimit(shortString), shortString);

  const shortObject = { status: 'success', count: 42 };
  assert.deepEqual(applyTokenLimit(shortObject), shortObject);

  assert.equal(applyTokenLimit(null), null);
  assert.equal(applyTokenLimit(undefined), undefined);
});

test('applyTokenLimit truncates oversized string payloads and appends security warning', () => {
  const oversizedPayload = 'A'.repeat(MAX_TOOL_RESPONSE_CHARS + 500);
  const result = applyTokenLimit(oversizedPayload) as string;

  assert.ok(typeof result === 'string');
  assert.ok(result.startsWith('A'.repeat(MAX_TOOL_RESPONSE_CHARS)));
  assert.ok(result.includes('WEBMCP_SECURITY_WARNING'));
  assert.ok(result.includes('Tool response exceeded maximum allowable limit'));
});

test('applyTokenLimit truncates oversized JSON payloads and appends security warning', () => {
  const largeObject = {
    content: 'X'.repeat(MAX_TOOL_RESPONSE_CHARS + 200),
  };
  const result = applyTokenLimit(largeObject) as string;

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('WEBMCP_SECURITY_WARNING'));
  assert.ok(result.includes('Tool response exceeded maximum allowable limit'));
});
