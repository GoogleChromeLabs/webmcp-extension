/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../src/providers.js';

test('PROVIDERS configuration contains gemini, openai, and anthropic', () => {
  assert.ok(PROVIDERS.gemini, 'Gemini provider exists');
  assert.ok(PROVIDERS.openai, 'OpenAI provider exists');
  assert.ok(PROVIDERS.anthropic, 'Anthropic provider exists');

  assert.equal(PROVIDERS.gemini.label, 'Gemini');
  assert.ok(PROVIDERS.gemini.models.includes('gemini-3.5-flash'));
  assert.ok(PROVIDERS.openai.models.includes('gpt-5.1'));
  assert.ok(PROVIDERS.anthropic.models.includes('claude-opus-4-8'));
});
