/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type OutputUnit, Validator } from '@cfworker/json-schema';
import { isToolUntrusted } from './toolEncoder.js';
import { type WebMCPTool } from '../types/index.js';

/**
 * What happens to a tool's result on its way back to the model: it is cut to
 * a size the context can take, and spotlighted when the page marked the tool
 * as returning untrusted content. Kept apart from the agent loop so each rule
 * can be read and tested on its own.
 */

/** Tool results longer than this are cut, so a page cannot flood the model's context. */
export const MAX_TOOL_RESPONSE_CHARS = 8000;

export function applyTokenLimit(result: unknown): unknown {
  if (result === undefined || result === null) return result;
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str && str.length > MAX_TOOL_RESPONSE_CHARS) {
    console.warn(
      `[WebMCP Security] Tool payload exceeded limit: ${str.length} chars (max: ${MAX_TOOL_RESPONSE_CHARS})`
    );
    const truncated = str.slice(0, MAX_TOOL_RESPONSE_CHARS);
    return `${truncated}\n\n[WEBMCP_SECURITY_WARNING: Tool response exceeded maximum allowable limit (${str.length} > ${MAX_TOOL_RESPONSE_CHARS} characters) and was truncated to protect against context exhaustion and prompt injection.]`;
  }
  return result;
}

/** At most this many schema violations are reported back to the model. */
const MAX_REPORTED_VIOLATIONS = 3;

/**
 * Checks a tool's result against the `outputSchema` the page declared for it.
 *
 * The schema is not sent to the model: only Gemini has a field for it, and
 * telling the model what a result should look like matters less than knowing
 * that the result it got really does. So the check happens here, before the
 * result is cut or spotlighted, for every backend alike.
 *
 * WebMCP hands results over JSON-serialized, so a string is parsed first, and
 * only checked as a string when it is not JSON (such as the JSON-LD text of a
 * cross-document form, when it is malformed).
 *
 * `@cfworker/json-schema` is used because it never evaluates code, which the
 * extension's content security policy would not allow.
 *
 * @returns Why the result does not match, or null when it does, when the tool
 *   declares no schema, or when the schema itself cannot be used.
 */
export function checkOutputSchema(result: unknown, tool?: WebMCPTool): string | null {
  const schema = tool?.outputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;

  let instance = result;
  if (typeof result === 'string') {
    try {
      instance = JSON.parse(result);
    } catch {}
  }

  let errors: OutputUnit[];
  try {
    ({ errors } = new Validator(schema, '2020-12').validate(instance));
  } catch (err: unknown) {
    // A schema the validator cannot work with, such as one with a `$ref` to
    // nowhere, is the page's mistake, and does not cost the model the result.
    console.warn(`[WebMCP] Output schema of tool "${tool?.name}" could not be used:`, err);
    return null;
  }
  if (errors.length === 0) return null;

  const violations = errors
    .slice(0, MAX_REPORTED_VIOLATIONS)
    .map(({ instanceLocation, error }) => `${instanceLocation}: ${error}`);
  if (errors.length > MAX_REPORTED_VIOLATIONS) violations.push('…');
  return `The tool result does not match the tool's output schema. ${violations.join(' ')}`;
}

/**
 * Base64-encodes a UTF-8 string in the browser.
 *
 * `btoa` only accepts Latin-1, and the old `unescape(encodeURIComponent(...))`
 * trick throws a URIError on a lone surrogate — which `applyTokenLimit` can
 * produce when it truncates mid-character. `TextEncoder` replaces unpaired
 * surrogates with U+FFFD instead of throwing, so this cannot fail on any input.
 */
function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  // Chunked to stay well under the argument-count limit of String.fromCharCode.
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Spotlights the result of a tool marked `untrustedContentHint: true`, and
 * returns any other result as it is.
 *
 * Encoding is the stronger spotlighting, but it takes a model that decodes
 * base64 reliably. Callers that pass a fence get delimiting instead, with any
 * forged closing marker stripped so the data cannot break out.
 */
export function applySpotlighting(result: unknown, tool?: WebMCPTool, fence?: string): unknown {
  if (!isToolUntrusted(tool)) return result;

  const rawStr = typeof result === 'string' ? result : JSON.stringify(result);

  if (fence) {
    const fenced = (rawStr || '').split(`</${fence}>`).join('');
    return `<${fence}>\n${fenced}\n</${fence}>`;
  }

  return encodeBase64(rawStr || '');
}

/**
 * Refreshes the page's tools after a round of tool calls, and waits until they
 * have settled, so the next request declares the tools the page has now.
 *
 * A call can change them, by navigating, or by rendering a view with tools of
 * its own, and a page can take a while to register those: the content script
 * only reports the list once its changes have paused. So this waits for a
 * report, then for `quietMs` without another, and gives up after `timeoutMs`,
 * keeping whatever tools arrived by then.
 */
export async function waitForToolsToSettle(
  toolsRef: { readonly current: WebMCPTool[] },
  {
    requestTools,
    signal,
    quietMs = 250,
    timeoutMs = 2000,
    pollMs = 25,
  }: {
    requestTools: () => Promise<void>;
    signal?: AbortSignal;
    quietMs?: number;
    timeoutMs?: number;
    pollMs?: number;
  }
): Promise<void> {
  const start = performance.now();
  // Every report replaces the array, even when the tools are the same.
  let seen = toolsRef.current;
  let lastReport: number | null = null;

  try {
    await requestTools();
  } catch {}

  while (!signal?.aborted && performance.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (toolsRef.current !== seen) {
      seen = toolsRef.current;
      lastReport = performance.now();
    }
    if (lastReport !== null && performance.now() - lastReport >= quietMs) return;
  }
}
