/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTokenLimit, MAX_TOOL_RESPONSE_CHARS } from '../src/hooks/useAgentSession.js';

test('applyTokenLimit leaves responses under the maximum character limit untouched', () => {
  const shortString = 'Short tool response with normal size data.';
  assert.equal(applyTokenLimit(shortString), shortString);

  const shortObject = { status: 'success', count: 42 };
  assert.deepEqual(applyTokenLimit(shortObject), shortObject);

  assert.equal(applyTokenLimit(null), null);
  assert.equal(applyTokenLimit(undefined), undefined);
});

test('applyTokenLimit rejects oversized string payloads', () => {
  const oversizedPayload = 'A'.repeat(MAX_TOOL_RESPONSE_CHARS + 500);
  assert.throws(
    () => applyTokenLimit(oversizedPayload),
    /Tool response exceeded maximum allowable limit .* and was rejected\./
  );
});

test('applyTokenLimit rejects oversized JSON payloads', () => {
  const largeObject = {
    content: 'X'.repeat(MAX_TOOL_RESPONSE_CHARS + 200),
  };
  assert.throws(
    () => applyTokenLimit(largeObject),
    /Tool response exceeded maximum allowable limit .* and was rejected\./
  );
});
