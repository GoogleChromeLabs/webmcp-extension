/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Content scripts cannot be ES modules, so the build bundles this file as a
// classic script (IIFE). The export only makes TypeScript treat it as a module,
// which keeps its top-level names out of the global scope.
export {};

console.debug(`[WebMCP] Content script injected in ${window.location.href}`);

const WEBMCP_DISABLED_MESSAGE =
  'Turn on the "WebMCP for testing" flag in about://flags and restart browser to use tools exposed by this website.';

interface ContentMessage {
  action?: string;
  name?: string;
  inputArgs?: unknown;
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
      reply(document.querySelector('script[type="application/ld+json"]')?.textContent);
    }
  } catch (error) {
    console.debug('[WebMCP] Content script error:', error);
  }
});

/**
 * Runs a tool of this frame and returns its result.
 *
 * A declarative form tool can post into a named iframe (`<form target>`). Its
 * result is then the JSON-LD the iframe loads, not the return value, so the
 * iframe's load is awaited and the result read from there.
 */
async function executeTool(modelContext: ModelContext, name: string, inputArgs: unknown): Promise<unknown> {
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
    result = await modelContext.executeTool(tool, JSON.stringify(inputArgs));
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

function debouncedListTools(modelContext: ModelContext, fromOrigins: string[]): void {
  clearTimeout(listToolsTimeout);
  listToolsTimeout = setTimeout(() => listTools(modelContext, fromOrigins), 100);
}

async function listTools(modelContext: ModelContext, fromOrigins: string[]): Promise<void> {
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
 * to run the frame's tools. The service worker first injects a listener into
 * every frame that answers with the id Chrome gave it.
 */
async function getFrameId(targetWindow: Window): Promise<number | null> {
  await chrome.runtime.sendMessage({ action: 'INJECT_GET_FRAME_ID' });
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
