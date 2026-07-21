/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, createChat } from '../src/providers.js';

test('PROVIDERS configuration contains gemini, openai, and anthropic', () => {
  assert.ok(PROVIDERS.gemini, 'Gemini provider exists');
  assert.ok(PROVIDERS.openai, 'OpenAI provider exists');
  assert.ok(PROVIDERS.anthropic, 'Anthropic provider exists');

  assert.equal(PROVIDERS.gemini.label, 'Gemini');
  assert.ok(PROVIDERS.gemini.models.includes('gemini-3.5-flash'));
  assert.ok(PROVIDERS.openai.models.includes('gpt-5.1'));
  assert.ok(PROVIDERS.anthropic.models.includes('claude-opus-4-8'));
});

test('createChat creates instance for Gemini provider', () => {
  const chat = createChat({
    provider: 'gemini',
    apiKey: 'fake-api-key',
    model: 'gemini-3.5-flash',
    systemInstruction: ['Test system instruction'],
    toolDecls: [
      {
        name: 'testTool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
      },
    ],
    trace: [],
  });

  assert.ok(chat);
  assert.equal(typeof chat.send, 'function');
  assert.equal(typeof chat.sendToolResults, 'function');
  assert.equal(typeof chat.setTools, 'function');
});

test('createChat creates instance for OpenAI provider', () => {
  const chat = createChat({
    provider: 'openai',
    apiKey: 'fake-openai-key',
    model: 'gpt-5.1',
    systemInstruction: ['Test system instruction'],
    toolDecls: [],
    trace: [],
  });

  assert.ok(chat);
  assert.equal(typeof chat.send, 'function');
  assert.equal(typeof chat.sendToolResults, 'function');
});

test('createChat throws error for unknown provider', () => {
  assert.throws(() => {
    createChat({
      provider: 'unknown-provider' as any,
      apiKey: 'key',
      model: 'model',
      systemInstruction: [],
      toolDecls: [],
      trace: [],
    });
  }, /Unknown provider/);
});
