/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Runs in the page's main world, not the content script's isolated one: the
// page calls `requestToken()` and `resumeTool()` on its own objects, which the
// content script cannot see. This hook wraps both, and reports what happens to
// the content script through `CONTINUATION_EVENT`. It does not change what the
// page gets back.
//
// Bundled as a classic script (IIFE), like the content script.

import { CONTINUATION_EVENT, type ContinuationDetail } from './toolContinuationProtocol.js';

console.debug(`[WebMCP] Tool continuation hook injected in ${window.location.href}`);

interface ToolInvocation {
  requestToken(): Promise<string>;
}

type ResumeCallback = (input: unknown, options: unknown) => unknown;

interface ResumableModelContext {
  resumeTool(token: string, callback: ResumeCallback): Promise<void>;
}

// The main world outlives the extension: after an update the old hook is still
// there and keeps reporting, so injecting the new one into open tabs must not
// wrap the methods a second time.
const HOOKED = Symbol.for('webmcp-extension.toolContinuationHook');

function report(detail: ContinuationDetail): void {
  let json: string;
  try {
    json = JSON.stringify(detail);
  } catch {
    // A result JSON cannot hold, e.g. one with cycles.
    json = JSON.stringify({ ...detail, result: String((detail as { result?: unknown }).result) });
  }
  document.dispatchEvent(new CustomEvent(CONTINUATION_EVENT, { detail: json }));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hook<T extends object>(proto: T | undefined, install: (proto: T) => void): void {
  if (!proto || (proto as Record<symbol, unknown>)[HOOKED]) return;
  Object.defineProperty(proto, HOOKED, { value: true });
  install(proto);
}

const invocationProto = (window as { ModelContextToolInvocation?: { prototype: ToolInvocation } })
  .ModelContextToolInvocation?.prototype;

hook(invocationProto, (proto) => {
  const requestToken = proto.requestToken;
  if (typeof requestToken !== 'function') return;
  proto.requestToken = async function (this: ToolInvocation) {
    const token = await requestToken.call(this);
    // Reported before the page gets the token, so before it can navigate.
    report({ type: 'tokenRequested' });
    return token;
  };
});

const modelContext = document.modelContext as object | undefined;
const modelContextProto = modelContext && (Object.getPrototypeOf(modelContext) as ResumableModelContext);

hook(modelContextProto, (proto) => {
  const resumeTool = proto.resumeTool;
  if (typeof resumeTool !== 'function') return;
  proto.resumeTool = function (this: ResumableModelContext, token: string, callback: ResumeCallback) {
    console.debug(`[WebMCP] resumeTool() called with token "${token}" in ${window.location.href}`);
    // Let the browser reject a bad callback with its own error.
    if (typeof callback !== 'function') return resumeTool.call(this, token, callback);
    report({ type: 'resumeRequested' });
    const accepted = resumeTool.call(this, token, async (input, options) => {
      console.debug(`[WebMCP] resumeTool() callback called with ${JSON.stringify(input)}`);
      try {
        const result = await callback.call(undefined, input, options);
        console.debug('[WebMCP] resumeTool() callback returned', result);
        report({ type: 'resumed', result });
        return result;
      } catch (error) {
        console.debug('[WebMCP] resumeTool() callback threw', error);
        report({ type: 'resumed', error: toMessage(error) });
        throw error;
      }
    });
    accepted.then(
      () => console.debug(`[WebMCP] resumeTool() accepted token "${token}"`),
      (error: unknown) => {
        console.debug(`[WebMCP] resumeTool() rejected token "${token}"`, error);
        report({ type: 'resumeRejected', error: toMessage(error) });
      },
    );
    return accepted;
  };
});
