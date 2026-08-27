/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

console.debug(`[WebMCP] Content script injected in ${window.location.href}`);

chrome.runtime.onMessage.addListener((message, _, reply) => {
  const { action, name, inputArgs, fromOrigins } = message;
  try {
    if (action == 'LIST_TOOLS') {
      debouncedListTools(fromOrigins);
      if (document.modelContext) {
        document.modelContext.ontoolchange = debouncedListTools.bind(null, fromOrigins);
      }
    }
    if (action == 'EXECUTE_TOOL') {
      console.debug(`[WebMCP] Execute tool "${name}" with ${inputArgs} in ${window.location.href}`);
      let targetFrame, loadPromise;
      // Check if this tool is associated with a form target
      const formTarget = document.querySelector(`form[toolname="${name}"]`)?.target;
      if (formTarget) {
        // May be null, e.g. for target="_blank"; the result then lives in a
        // new tab and the sidebar retrieves it from there.
        targetFrame = document.querySelector(`[name=${formTarget}]`);
      }
      if (targetFrame) {
        loadPromise = new Promise((resolve) => {
          targetFrame.addEventListener('load', resolve, { once: true });
        });
      }

      executeTool(name, inputArgs)
        .then(async (result) => {
          // If result is null and we have a target frame, wait for the frame to reload.
          if (result === null && targetFrame) {
            console.debug(`[WebMCP] Waiting for form target ${targetFrame} to load`);
            await loadPromise;
            console.debug('[WebMCP] Get cross document script tool result');
            result = targetFrame.contentWindow.document.querySelector(
              'script[type="application/ld+json"]',
            )?.textContent;
          }
          reply(result);
        })
        .catch(({ message }) => reply(JSON.stringify(message)));
      return true;
    }
    if (action == 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') {
      console.debug(`[WebMCP] Get cross document script tool result in ${window.location.href}`);
      reply(document.querySelector('script[type="application/ld+json"]')?.textContent);
    }
  } catch ({ message }) {
    chrome.runtime.sendMessage({ message });
  }
});

let timeout;
function debouncedListTools(fromOrigins) {
  clearTimeout(timeout);
  timeout = setTimeout(() => listTools(fromOrigins), 100);
}

async function listTools(fromOrigins) {
  try {
    let tools = [];
    const contextTools = await fetchToolsFromContext(fromOrigins);
    for (const tool of contextTools) {
      const frameId = !tool.window || tool.window == window ? 0 : await getFrameId(tool.window);
      tools.push({
        description: tool.description,
        inputSchema: tool.inputSchema,
        readOnlyHint: tool.annotations?.readOnlyHint,
        untrustedContentHint: tool.annotations?.untrustedContentHint,
        name: tool.name,
        frameId,
      });
    }
    console.debug(`[WebMCP] Got ${tools.length} tools`, tools);
    chrome.runtime.sendMessage({ tools, url: window.location.href });
  } catch (err) {
    console.warn('[WebMCP] listTools error:', err);
    chrome.runtime.sendMessage({ message: err.message || String(err) });
  }
}

/**
 * Fetches tools either from native document.modelContext or via postMessage from the polyfill.
 */
async function fetchToolsFromContext(fromOrigins) {
  if (document.modelContext) {
    return document.modelContext.getTools({ fromOrigins });
  }

  // Request tools from MAIN world polyfill
  return new Promise((resolve) => {
    const requestId = 'req-tools-' + Math.random().toString(36).substring(2);
    let timer;

    const listener = (event) => {
      const { data } = event;
      if (data && data.type === 'WEBMCP_GET_TOOLS_RESPONSE' && data.requestId === requestId) {
        window.removeEventListener('message', listener);
        clearTimeout(timer);
        resolve(data.tools || []);
      }
    };

    window.addEventListener('message', listener);
    window.postMessage({ type: 'WEBMCP_GET_TOOLS_REQUEST', requestId }, '*');

    timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve([]);
    }, 1500);
  });
}

/**
 * Executes a tool either via native document.modelContext or via postMessage from the polyfill.
 */
async function executeTool(name, inputArgs) {
  if (document.modelContext) {
    const tools = await document.modelContext.getTools();
    const tool = tools.find((t) => t.name === name && t.window === window);
    let parsedArgs = inputArgs;
    try {
      if (typeof inputArgs === 'string') parsedArgs = JSON.parse(inputArgs);
    } catch {}
    try {
      return await document.modelContext.executeTool(tool, parsedArgs);
    } catch (e) {
      if (e.message?.startsWith('Failed to parse input')) {
        return await document.modelContext.executeTool(tool, inputArgs);
      }
      throw e;
    }
  }

  // Execute tool via MAIN world polyfill
  return new Promise((resolve, reject) => {
    const requestId = 'req-exec-' + Math.random().toString(36).substring(2);
    let timer;

    const listener = (event) => {
      const { data } = event;
      if (data && data.type === 'WEBMCP_EXECUTE_TOOL_RESPONSE' && data.requestId === requestId) {
        window.removeEventListener('message', listener);
        clearTimeout(timer);
        if (data.success) {
          resolve(data.result);
        } else {
          reject(new Error(data.error || 'Tool execution failed'));
        }
      }
    };

    window.addEventListener('message', listener);
    window.postMessage(
      {
        type: 'WEBMCP_EXECUTE_TOOL_REQUEST',
        requestId,
        name,
        args: inputArgs,
      },
      '*'
    );

    timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(new Error(`Timeout waiting for tool "${name}" execution response`));
    }, 20000);
  });
}

async function getFrameId(targetWindow) {
  await chrome.runtime.sendMessage({ action: 'INJECT_GET_FRAME_ID' });
  const promise = new Promise((resolve) => {
    let timeoutId;
    const listener = ({ source, data }) => {
      if (source == targetWindow && data.action === 'GET_FRAME_ID_RESPONSE') {
        window.removeEventListener('message', listener);
        clearTimeout(timeoutId);
        resolve(data.frameId);
      }
    };
    window.addEventListener('message', listener);
    timeoutId = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve(null);
    }, 2000);
  });
  targetWindow.postMessage({ action: 'GET_FRAME_ID' }, '*');
  return promise;
}

window.addEventListener('toolactivated', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" started execution.`);
});

window.addEventListener('toolcancel', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" execution is cancelled.`);
});

if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'contentScriptReady' }).catch(() => {});
}
