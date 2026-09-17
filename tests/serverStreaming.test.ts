/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { chunkText, streamChatTurn } from '../server/streaming.js';

/** A chunk as the Gemini SDK yields one. */
const textChunk = (text: string, { thought = false } = {}) => ({
  candidates: [{ content: { parts: [{ text, ...(thought ? { thought: true } : {}) }] } }],
});

/** Stands in for the response the turn is streamed to. */
class FakeResponse extends EventEmitter {
  lines: string[] = [];
  writableEnded = false;

  write(line: string) {
    this.lines.push(line);
    return true;
  }

  /** The client went away before the response was written in full. */
  close() {
    this.emit('close');
  }

  /** The response was written in full, and the connection closed after it. */
  finish() {
    this.writableEnded = true;
    this.emit('close');
  }
}

/**
 * Stands in for a chat session. Yields `chunks`, one per call to `next()`, so
 * a test can act between them, and records what it was called with.
 */
function fakeChatSession(chunks: unknown[], { throwAfter = -1, error = new Error('Gemini failed') } = {}) {
  const session = {
    params: undefined as undefined | { config?: { abortSignal?: AbortSignal; systemInstruction?: string } },
    yielded: 0,
    async sendMessageStream(params: { config?: { abortSignal?: AbortSignal; systemInstruction?: string } }) {
      session.params = params;
      return (async function* () {
        for (const chunk of chunks) {
          if (session.yielded === throwAfter) throw error;
          session.yielded++;
          yield chunk;
        }
        if (chunks.length === throwAfter) throw error;
      })();
    },
  };
  return session;
}

test('chunkText reads the text of a chunk, and leaves the model thoughts out', () => {
  assert.equal(chunkText(textChunk('Hello')), 'Hello');
  assert.equal(chunkText(textChunk('Thinking about it', { thought: true })), '');
  assert.equal(
    chunkText({ candidates: [{ content: { parts: [{ text: 'a' }, { thought: true, text: 'b' }, { text: 'c' }] } }] }),
    'ac'
  );
  // A chunk that only carries a tool call has no text, and neither has an
  // empty one.
  assert.equal(chunkText({ candidates: [{ content: { parts: [{ functionCall: { name: 'book' } }] } }] }), '');
  assert.equal(chunkText({}), '');
});

test('streamChatTurn writes a line per piece of text and returns the whole turn', async () => {
  // The last chunk of a turn carries no text of its own, only why it ended.
  const candidates = [{ content: { parts: [] }, finishReason: 'STOP' }];
  const session = fakeChatSession([
    textChunk('Hello, '),
    { ...textChunk('thinking'), candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] },
    { ...textChunk('world.'), functionCalls: [{ name: 'book_table', args: { partySize: 2 } }] },
    { candidates },
  ]);
  const res = new FakeResponse();

  const result = await streamChatTurn({
    chatSession: session,
    sendMessageParams: { message: 'Hi' },
    config: { systemInstruction: 'Be brief.' },
    res,
  });

  assert.deepEqual(res.lines, [`${JSON.stringify({ text: 'Hello, ' })}\n`, `${JSON.stringify({ text: 'world.' })}\n`]);
  assert.deepEqual(result, {
    stopped: false,
    text: 'Hello, world.',
    functionCalls: [{ name: 'book_table', args: { partySize: 2 } }],
    candidates,
  });
  // The caller's config is kept, with the abort signal added, and the last
  // line is the caller's to write.
  assert.equal(session.params?.config?.systemInstruction, 'Be brief.');
  assert.ok(session.params?.config?.abortSignal instanceof AbortSignal);
  assert.equal(session.params?.config?.abortSignal?.aborted, false);
});

test('streamChatTurn stops the model when the side panel closes the connection', async () => {
  const res = new FakeResponse();
  // The client goes away while the second chunk is being read.
  const session = fakeChatSession([textChunk('Hello, '), textChunk('world.'), textChunk('And more.')]);
  const sendMessageStream = session.sendMessageStream.bind(session);
  session.sendMessageStream = async (params) => {
    const stream = await sendMessageStream(params);
    return (async function* () {
      for await (const chunk of stream) {
        yield chunk;
        if (session.yielded === 1) res.close();
      }
    })();
  };

  const result = await streamChatTurn({ chatSession: session, sendMessageParams: {}, config: {}, res });

  assert.deepEqual(result, { stopped: true });
  // Gemini was told to stop, and nothing was read after that.
  assert.equal(session.params?.config?.abortSignal?.aborted, true);
  assert.equal(session.yielded, 2);
  assert.deepEqual(res.lines, [`${JSON.stringify({ text: 'Hello, ' })}\n`, `${JSON.stringify({ text: 'world.' })}\n`]);
});

test('streamChatTurn treats what an aborted stream throws as the stop it is', async () => {
  const res = new FakeResponse();
  const session = fakeChatSession([textChunk('Hello, ')], {
    throwAfter: 1,
    error: new DOMException('The operation was aborted.', 'AbortError'),
  });
  const sendMessageStream = session.sendMessageStream.bind(session);
  session.sendMessageStream = async (params) => {
    const stream = await sendMessageStream(params);
    return (async function* () {
      for await (const chunk of stream) {
        res.close();
        yield chunk;
      }
    })();
  };

  assert.deepEqual(await streamChatTurn({ chatSession: session, sendMessageParams: {}, config: {}, res }), {
    stopped: true,
  });
});

test('streamChatTurn passes a real failure on, and does not stop on a finished response', async () => {
  const failing = fakeChatSession([textChunk('Hello, ')], { throwAfter: 1 });
  const res = new FakeResponse();
  await assert.rejects(
    () => streamChatTurn({ chatSession: failing, sendMessageParams: {}, config: {}, res }),
    /Gemini failed/
  );

  // The connection closing after a response was written in full is no reason
  // to abort anything.
  const finished = fakeChatSession([textChunk('All done.')]);
  const other = new FakeResponse();
  const result = await streamChatTurn({ chatSession: finished, sendMessageParams: {}, config: {}, res: other });
  other.finish();
  assert.equal(result.stopped, false);
  assert.equal(result.text, 'All done.');
  assert.equal(finished.params?.config?.abortSignal?.aborted, false);
});
