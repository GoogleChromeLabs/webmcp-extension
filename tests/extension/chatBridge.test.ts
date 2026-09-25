/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { ModelMessage } from 'ai';
import { appendTurnMessages } from '../../server/tools.ts';
import { endAllChats, endChat, sendChatTurn } from '../../extension/sidepanel/services/chatBridge.js';

function stubServer(replies: Array<Record<string, unknown> | Error>) {
  const original = globalThis.fetch;
  const sent: Array<{ url: string; body: any }> = [];
  let index = 0;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    sent.push({ url: String(url), body });
    if (String(url).endsWith('/api/chat/reset')) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const reply = replies[index++];
    if (reply instanceof Error) throw reply;
    const line = JSON.stringify({ done: true, text: '', functionCalls: [], ...reply });
    return new Response(`${line}\n`, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }) as unknown as typeof fetch;

  return {
    sent,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('sendChatTurn forwards requests to /api/chat and returns text and functionCalls', async () => {
  const server = stubServer([
    { chatId: 'c1', text: 'Checking cart...', functionCalls: [{ id: 'call_1', name: 'get_cart', args: {} }] },
    { chatId: 'c1', text: 'One hat.', functionCalls: [] },
  ]);

  try {
    const first = await sendChatTurn({ chatId: 'c1', message: 'What is in my cart?', tools: [] });
    assert.equal(first.chatId, 'c1');
    assert.equal(first.text, 'Checking cart...');
    assert.deepEqual(first.functionCalls, [{ id: 'call_1', name: 'get_cart', args: {} }]);
    assert.equal(server.sent[0].body.message, 'What is in my cart?');

    const second = await sendChatTurn({
      chatId: 'c1',
      toolResponses: [{ functionResponse: { id: 'call_1', name: 'get_cart', response: { result: 'one hat' } } }],
      tools: [],
    });
    assert.equal(second.text, 'One hat.');
    assert.equal(server.sent[1].body.toolResponses[0].functionResponse.id, 'call_1');
  } finally {
    server.restore();
  }
});

test('endChat ends one server chat, endAllChats ends them all', async () => {
  const server = stubServer([]);
  try {
    endChat('tab-99');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(server.sent.length, 1);
    assert.ok(server.sent[0].url.endsWith('/api/chat/reset'));
    assert.deepEqual(server.sent[0].body, { chatId: 'tab-99' });

    endAllChats();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(server.sent.length, 2);
    assert.deepEqual(server.sent[1].body, {});

    // The on-device backend never calls the server.
    endChat('tab-99', { onDevice: true });
    endAllChats({ onDevice: true });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(server.sent.length, 2);
  } finally {
    server.restore();
  }
});

test('appendTurnMessages pairs tool results by toolCallId and preserves providerOptions', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'What is in my cart?' }] },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get_cart',
          input: {},
          providerOptions: { google: { thoughtSignature: 'sig_123' } },
        },
      ],
    },
  ];

  const next = appendTurnMessages(history, {
    toolResponses: [
      { functionResponse: { id: 'call_1', name: 'get_cart', response: { result: 'one hat' } } },
    ],
  });

  assert.equal(next.length, 3);
  assert.deepEqual(next[2], {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'get_cart',
        output: { type: 'text', value: 'one hat' },
        providerOptions: { google: { thoughtSignature: 'sig_123' } },
      },
    ],
  });
});

test('appendTurnMessages records failed tool calls, JSON object results, and empty results', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Go' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'buy', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'total', input: {} },
        { type: 'tool-call', toolCallId: 'c', toolName: 'ping', input: {} },
      ],
    },
  ];

  const next = appendTurnMessages(history, {
    toolResponses: [
      { functionResponse: { id: 'a', name: 'buy', response: { error: 'User denied permission' } } },
      { functionResponse: { id: 'b', name: 'total', response: { result: { cents: 2900 } } } },
      { functionResponse: { id: 'c', name: 'ping', response: {} } },
    ],
  });

  const content = (next[2] as any).content;
  assert.deepEqual(content[0].output, { type: 'error-text', value: 'User denied permission' });
  assert.deepEqual(content[1].output, { type: 'json', value: { cents: 2900 } });
  assert.deepEqual(content[2].output, { type: 'text', value: '' });
});

test('appendTurnMessages settles unanswered tool calls before appending a new user message', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'First' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call_unanswered', toolName: 'book', input: {} }],
    },
  ];

  const next = appendTurnMessages(history, { message: 'Never mind, new question' });
  assert.equal(next.length, 4);
  assert.equal(next[2].role, 'tool');
  assert.deepEqual((next[2] as any).content[0].output, {
    type: 'error-text',
    value: 'No response was produced for this call.',
  });
  assert.deepEqual(next[3], {
    role: 'user',
    content: [{ type: 'text', text: 'Never mind, new question' }],
  });
});

test('appendTurnMessages does not reuse an ID-matched response for a second call to the same tool', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Book two rooms' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'book', input: { room: 1 } },
        { type: 'tool-call', toolCallId: 'call_2', toolName: 'book', input: { room: 2 } },
      ],
    },
  ];

  const next = appendTurnMessages(history, {
    toolResponses: [
      { functionResponse: { id: 'call_1', name: 'book', response: { result: 'Booked room 1' } } },
    ],
  });

  const content = (next[2] as any).content;
  assert.equal(content.length, 2);
  assert.deepEqual(content[0].output, { type: 'text', value: 'Booked room 1' });
  assert.deepEqual(content[1].output, {
    type: 'error-text',
    value: 'No response was produced for this call.',
  });
});

