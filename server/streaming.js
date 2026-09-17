/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The text of one streamed chunk, without the model's thoughts, the way the
 * SDK's own `text` getter reads it, but without its warnings about the
 * non-text parts a tool call brings.
 */
export function chunkText(chunk) {
  const parts = chunk?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
}

/**
 * Streams one Gemini turn to `res` as newline-delimited JSON: a `{ text }`
 * line for every piece of text as it arrives. The caller writes the last line,
 * so that it can put its own payload in it, and handles the logging.
 *
 * Stopping a turn in the side panel aborts its fetch, which closes the
 * connection. That is passed on to Gemini, which would otherwise keep
 * generating a response nobody reads, and reported back as `stopped`, with
 * nothing left to write to. The response, not the request, is what to watch: a
 * request whose body has been read is already closed by now. `close` also
 * fires once a response has been written in full, which is no reason to abort.
 *
 * @returns {Promise<{stopped: boolean, text?: string, functionCalls?: object[], candidates?: object[]}>}
 */
export async function streamChatTurn({ chatSession, sendMessageParams, config, res }) {
  const clientGone = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) clientGone.abort();
  });

  let text = '';
  const functionCalls = [];
  let candidates = [];

  try {
    const streamParams = {
      ...sendMessageParams,
      config: { ...config, abortSignal: clientGone.signal },
    };
    for await (const chunk of await chatSession.sendMessageStream(streamParams)) {
      const piece = chunkText(chunk);
      if (piece) {
        text += piece;
        res.write(`${JSON.stringify({ text: piece })}\n`);
      }
      functionCalls.push(...(chunk.functionCalls || []));
      if (chunk.candidates) candidates = chunk.candidates;
      // The stream may not notice the abort itself.
      if (clientGone.signal.aborted) break;
    }
  } catch (error) {
    // Whatever an aborted stream throws is the stop, not a failure.
    if (!clientGone.signal.aborted) throw error;
  }

  if (clientGone.signal.aborted) return { stopped: true };
  return { stopped: false, text, functionCalls, candidates };
}
