/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Content scripts cannot be ES modules, so the build bundles this file as a
// classic script (IIFE). The export only makes TypeScript treat it as a module,
// which keeps its top-level names out of the global scope.
export {};

import {
  CONTINUATION_EVENT,
  CONTINUE_ON_NEXT_DOCUMENT,
  type ContinuationDetail,
} from './toolContinuationProtocol.js';

console.debug(`[WebMCP] Content script injected in ${window.location.href}`);

const WEBMCP_DISABLED_MESSAGE =
  'Turn on the "WebMCP for testing" flag in about://flags and restart browser to use tools exposed by this website.';

// How long to wait for the browser to call a `resumeTool()` callback the page
// has registered.
const RESUME_TIMEOUT_MS = 10_000;

type ResumedDetail = Extract<ContinuationDetail, { type: 'resumed' }>;

// What the main-world hook (`toolContinuationHook.ts`) reported about tool
// continuations in this document.
let tokenRequested = false;
let resumed: Promise<ResumedDetail | undefined> | undefined;
let settleResumed: (detail?: ResumedDetail) => void = () => {};

document.addEventListener(CONTINUATION_EVENT, (event) => {
  // The page can fire this event too, so `detail` is not trusted to be ours.
  // That gives it nothing it lacks: it controls its tools' results anyway.
  const json = (event as CustomEvent).detail;
  if (typeof json !== 'string') return;
  let detail: ContinuationDetail | undefined;
  try {
    detail = JSON.parse(json);
  } catch {
    return;
  }
  switch (detail?.type) {
    case 'tokenRequested':
      tokenRequested = true;
      break;
    case 'resumeRequested':
      // From here on, tracks whether the resumed callback asks for a token.
      tokenRequested = false;
      resumed = new Promise((resolve) => {
        settleResumed = resolve;
      });
      break;
    case 'resumeRejected':
      console.debug(`[WebMCP] resumeTool() was rejected: ${detail.error}`);
      settleResumed();
      break;
    case 'resumed':
      settleResumed(detail);
      break;
  }
});

interface ContentMessage {
  action?: string;
  name?: string;
  inputArgs?: Record<string, unknown>;
  fromOrigins?: string[];
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, reply) => {
  const { action, name, inputArgs, fromOrigins = [] } = message;
  const modelContext = document.modelContext;
  if (!modelContext) {
    chrome.runtime.sendMessage({ message: WEBMCP_DISABLED_MESSAGE });
    // A tool call still gets an answer, so the model hears why it failed
    // instead of a closed message port.
    if (action === 'EXECUTE_TOOL') reply(JSON.stringify(WEBMCP_DISABLED_MESSAGE));
    return;
  }
  try {
    if (action === 'LIST_TOOLS') {
      debouncedListTools(modelContext, fromOrigins);
      modelContext.ontoolchange = () => debouncedListTools(modelContext, fromOrigins);
    }
    if (action === 'EXECUTE_TOOL' && name) {
      console.debug(`[WebMCP] Execute tool "${name}" with ${JSON.stringify(inputArgs)} in ${window.location.href}`);
      void (async () => {
        try {
          reply(await executeTool(modelContext, name, inputArgs));
        } catch (error) {
          reply(JSON.stringify(toMessage(error)));
        }
      })();
      // Keeps the message channel open until `reply` is called.
      return true;
    }
    if (action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') {
      console.debug(`[WebMCP] Get cross document script tool result in ${window.location.href}`);
      void getCrossDocumentResult().then(reply);
      // Keeps the message channel open until `reply` is called.
      return true;
    }
  } catch (error) {
    console.debug('[WebMCP] Content script error:', error);
  }
});

/**
 * The result of a tool that navigated to this document.
 *
 * If the page resumed the tool with `resumeTool()`, the result is what its
 * callback returns, unless the callback asks for a token again: the tool then
 * carries on in yet another document. Otherwise the result is the page's
 * JSON-LD.
 */
async function getCrossDocumentResult(): Promise<unknown> {
  if (resumed) {
    console.debug('[WebMCP] Waiting for resumeTool() callback result');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timeoutId = setTimeout(() => resolve(undefined), RESUME_TIMEOUT_MS);
    });
    const detail = await Promise.race([resumed, timeout]);
    clearTimeout(timeoutId);
    if (detail) {
      if (tokenRequested) {
        console.debug('[WebMCP] resumeTool() callback requested another token, continuing on the next document');
        return CONTINUE_ON_NEXT_DOCUMENT;
      }
      console.debug('[WebMCP] Got resumeTool() callback result', detail);
      return detail.error !== undefined ? JSON.stringify(detail.error) : detail.result;
    }
    console.debug('[WebMCP] No resumeTool() callback result, falling back to JSON-LD');
  }
  return document.querySelector('script[type="application/ld+json"]')?.textContent;
}

/**
 * Runs a tool of this frame and returns its result.
 *
 * A declarative form tool can post into a named iframe (`<form target>`). Its
 * result is then the JSON-LD the iframe loads, not the return value, so the
 * iframe's load is awaited and the result read from there.
 *
 * A tool that asks for a continuation token does not settle `executeTool()`
 * until its `resumeTool()` callback has run, and then with that callback's
 * result. If that happens in another document, this one has gone by then:
 * the side panel sees the message channel close, and asks the next document.
 */
async function executeTool(
  modelContext: WebMCP.ModelContext,
  name: string,
  inputArgs: Record<string, unknown> | undefined
): Promise<unknown> {
  // The tool name comes from the page, so it is compared as a value rather
  // than interpolated into a selector; there is then nothing to escape.
  const formTarget = [...document.forms].find((form) => form.getAttribute('toolname') === name)?.target;
  // May be missing, e.g. for target="_blank"; the result then lives in a new
  // tab and the side panel retrieves it from there.
  const targetFrame = formTarget
    ? (document.getElementsByName(formTarget)[0] as HTMLIFrameElement | undefined)
    : undefined;
  // Listen before running the tool, so a fast load is not missed.
  const targetLoaded =
    targetFrame && new Promise((resolve) => targetFrame.addEventListener('load', resolve, { once: true }));

  const tools = await modelContext.getTools();
  const tool = tools.find((t) => t.name === name && t.window === window);
  if (!tool) throw new Error(`Tool "${name}" is not available on this page.`);

  let result: unknown;
  try {
    result = await modelContext.executeTool(tool, inputArgs);
  } catch (error) {
    // TODO: Remove this when executeTool doesn't accept JSON stringified inputArgs anymore in Chrome Stable.
    if (!toMessage(error).startsWith('Failed to parse input')) throw error;
    // Older Chrome builds take the input as a JSON string, which the spec types do not allow.
    result = await modelContext.executeTool(tool, JSON.stringify(inputArgs) as unknown as object);
  }

  if (result === null && targetFrame) {
    console.debug(`[WebMCP] Waiting for form target ${formTarget} to load`);
    await targetLoaded;
    console.debug('[WebMCP] Get cross document script tool result');
    result = targetFrame.contentWindow?.document.querySelector('script[type="application/ld+json"]')?.textContent;
  }
  return result;
}

/**
 * Turns anything that can be thrown into a string safe to send over the wire:
 * a rejection can be a string, null, or a DOMException from touching a
 * cross-origin `contentWindow`.
 */
function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return String(message ?? error);
}

let listToolsTimeout: ReturnType<typeof setTimeout> | undefined;

function debouncedListTools(modelContext: WebMCP.ModelContext, fromOrigins: string[]): void {
  clearTimeout(listToolsTimeout);
  listToolsTimeout = setTimeout(() => listTools(modelContext, fromOrigins), 100);
}

async function listTools(modelContext: WebMCP.ModelContext, fromOrigins: string[]): Promise<void> {
  const tools = [];
  for (const tool of await modelContext.getTools({ fromOrigins })) {
    const frameId = tool.window === window ? 0 : await getFrameId(tool.window);
    tools.push({
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnlyHint: tool.annotations?.readOnlyHint,
      untrustedContentHint: tool.annotations?.untrustedContentHint,
      consequentialHint: tool.annotations?.consequentialHint,
      name: tool.name,
      frameId,
    });
  }
  console.debug(`[WebMCP] Got ${tools.length} tools`, tools);
  chrome.runtime.sendMessage({ tools, url: window.location.href });
}

/**
 * Asks a child frame for its extension frame id, which the side panel needs
 * to run the frame's tools. The copy of this script in that frame answers with
 * the id Chrome gave it (see the `GET_FRAME_ID` listener below).
 */
async function getFrameId(targetWindow: Window): Promise<number | null> {
  const frameId = new Promise<number | null>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      // `data` is attacker-controlled: any frame can post anything, including
      // null or a bare string, so never dereference it unguarded.
      if (source === targetWindow && data?.action === 'GET_FRAME_ID_RESPONSE') {
        window.removeEventListener('message', listener);
        clearTimeout(timeoutId);
        resolve(data.frameId);
      }
    };
    window.addEventListener('message', listener);
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve(null);
    }, 2000);
  });
  targetWindow.postMessage({ action: 'GET_FRAME_ID' }, '*');
  return frameId;
}

// Answers a parent frame's `getFrameId`. This script runs in every frame (the
// manifest sets `all_frames`, and the service worker injects it into tabs that
// were open before install), so every frame can answer for itself.
window.addEventListener('message', async ({ data, source, origin }) => {
  // Any frame can post anything here, so `data` may not be an object, and
  // `source` is null when the sending context has already gone away.
  if (data?.action !== 'GET_FRAME_ID' || !source) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const frameId: number | undefined = await chrome.runtime.sendMessage({ action: 'GET_FRAME_ID' });
    if (frameId != null) {
      (source as Window).postMessage({ action: 'GET_FRAME_ID_RESPONSE', frameId }, origin);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.debug('[WebMCP] failed to get frameId after 10 attempts');
});

type ToolEvent = Event & { toolName?: string };

// TODO: Remove when window.ontoolactivated and window.ontoolcancel are removed in Chrome Stable.
function addToolEventListener(type: 'toolactivated' | 'toolcancel', listener: (event: ToolEvent) => void): void {
  const target: EventTarget =
    document.modelContext && `on${type}` in document.modelContext ? document.modelContext : window;
  target.addEventListener(type, listener);
}

addToolEventListener('toolactivated', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" started execution.`);
});

addToolEventListener('toolcancel', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" execution is cancelled.`);
});

if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'contentScriptReady' }).catch(() => {});
}
