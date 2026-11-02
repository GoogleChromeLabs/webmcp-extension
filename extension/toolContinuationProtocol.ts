/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared by the main-world hook (`toolContinuationHook.ts`), the content script
// and the side panel. It only holds names and types, so importing it runs
// nothing.
//
// Tool continuations (https://github.com/webmachinelearning/webmcp/pull/327)
// let a tool carry on in another document. While it runs, the tool calls
// `invocation.requestToken()` and hands the token to the next document, which
// calls `document.modelContext.resumeTool(token, callback)`. The browser then
// calls `callback`, and what it returns is the tool's result.

/**
 * The event the main-world hook fires on `document` to tell the content script
 * what the page did. Its `detail` is a JSON string, a `ContinuationDetail`:
 * object details do not cross from the main world into the content script's.
 */
export const CONTINUATION_EVENT = 'webmcp-extension:tool-continuation';

export type ContinuationDetail =
  /**
   * A tool asked for a token: it goes on elsewhere. `executeTool()` waits for
   * that by itself, but a resumed callback's return value is then partial.
   */
  | { type: 'tokenRequested' }
  /** The page called `resumeTool()`; a `resumed` or `resumeRejected` follows. */
  | { type: 'resumeRequested' }
  /** The browser turned the token down, so the callback will not run. */
  | { type: 'resumeRejected'; error: string }
  /** The resumed callback settled with `result`, or threw `error`. */
  | { type: 'resumed'; result?: unknown; error?: string };

/**
 * What the content script replies, instead of a result, when a resumed
 * callback asked for a token again: the side panel then waits for the result
 * in the document after.
 */
export const CONTINUE_ON_NEXT_DOCUMENT = { webmcpToolContinuation: true } as const;

export function isContinueOnNextDocument(value: unknown): boolean {
  return (value as { webmcpToolContinuation?: unknown } | null | undefined)?.webmcpToolContinuation === true;
}
