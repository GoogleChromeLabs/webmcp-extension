/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

console.debug(`[WebMCP] Content script injected in ${window.location.href}`);

chrome.runtime.onMessage.addListener((message, _, reply) => {
  const { action, name, inputArgs, location, fromOrigins } = message;
  try {
    if (!document.modelContext) {
      throw new Error('Error: You must run Chrome with the "WebMCP for testing" flag enabled.');
    }
    if (action === 'LIST_TOOLS') {
      listTools(fromOrigins);
      document.modelContext.ontoolchange = listTools.bind(null, fromOrigins);
    }
    if (action === 'EXECUTE_TOOL') {
      const isMainFrame = window === window.top;
      const cleanLocation = location ? location.split('#')[0] : '';
      const cleanCurrent = window.location.href.split('#')[0];
      const isMatchingLocation =
        !location ||
        location === window.location.href ||
        (isMainFrame && (!cleanLocation || cleanLocation === cleanCurrent));

      if (!isMatchingLocation) return;
      console.debug(
        `[WebMCP] Execute tool "${name}" with ${inputArgs} in ${location || window.location.href}`
      );
      let targetFrame, loadPromise;
      // Check if this tool is associated with a form target
      const escapedName = CSS?.escape ? CSS.escape(name) : name.replace(/["\\]/g, '\\$&');
      const formTarget = document.querySelector(`form[toolname="${escapedName}"]`)?.target;
      if (formTarget) {
        const escapedTarget = CSS?.escape
          ? CSS.escape(formTarget)
          : formTarget.replace(/["\\]/g, '\\$&');
        targetFrame = document.querySelector(`[name="${escapedTarget}"]`);
        loadPromise = new Promise((resolve) => {
          targetFrame?.addEventListener('load', resolve, { once: true });
        });
      }
      // Execute the experimental tool
      document.modelContext
        .getTools()
        .then((tools) => {
          const tool = tools.find((t) => t.name === name);
          if (!tool) {
            throw new Error(`Tool "${name}" not found in ${window.location.href}`);
          }
          const stringArgs =
            typeof inputArgs === 'string' ? inputArgs : JSON.stringify(inputArgs || {});
          return document.modelContext.executeTool(tool, stringArgs);
        })
        .then(async (result) => {
          // If result is null and we have a target frame, wait for the frame to reload.
          if (result === null && targetFrame) {
            console.debug(`[WebMCP] Waiting for form target ${targetFrame} to load`);
            await loadPromise;
            console.debug('[WebMCP] Get cross document script tool result');
            try {
              result = targetFrame.contentWindow?.document?.querySelector(
                'script[type="application/ld+json"]'
              )?.textContent;
            } catch {
              result = null;
            }
          }
          reply(result);
        })
        .catch((err) => reply(JSON.stringify(err?.message || String(err))));
      return true;
    }
    if (action === 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') {
      if (location && !window.location.href.startsWith(location)) return;
      console.debug(`[WebMCP] Get cross document script tool result in ${location}`);
      reply(document.querySelector('script[type="application/ld+json"]')?.textContent);
    }
  } catch (err) {
    if (action === 'EXECUTE_TOOL') {
      reply(JSON.stringify(err?.message || String(err)));
    }
    chrome.runtime.sendMessage({ message: err?.message || String(err) });
  }
});

async function listTools(fromOrigins) {
  try {
    let tools = [];
    for (const tool of await document.modelContext.getTools({ fromOrigins })) {
      let location;
      try {
        location = tool.window.location.href;
      } catch {
        location = await getLocation(tool.window);
      }
      const inputSchema =
        typeof tool.inputSchema === 'string' ? tool.inputSchema : JSON.stringify(tool.inputSchema);
      tools.push({
        description: tool.description,
        inputSchema,
        readOnlyHint: tool.annotations?.readOnlyHint ? '✓' : undefined,
        untrustedContentHint: tool.annotations?.untrustedContentHint ? '✓' : undefined,
        name: tool.name,
        location,
      });
    }
    console.debug(`[WebMCP] Got ${tools.length} tools`, tools);
    chrome.runtime.sendMessage({ tools, url: window.location.href });
  } catch (err) {
    chrome.runtime.sendMessage({ message: err?.message || String(err) });
  }
}

function getLocation(crossOriginIframeWindow) {
  return new Promise((resolve) => {
    let timer;
    const listener = ({ data }) => {
      if (data?.action === 'GET_LOCATION_RESPONSE') {
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve(data.location);
      }
    };
    timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve(undefined);
    }, 500);
    window.addEventListener('message', listener);
    try {
      crossOriginIframeWindow.postMessage({ action: 'GET_LOCATION' }, '*');
    } catch {
      clearTimeout(timer);
      window.removeEventListener('message', listener);
      resolve(undefined);
    }
  });
}

window.addEventListener('message', ({ data, origin, source }) => {
  if (data && typeof data === 'object' && data.action === 'GET_LOCATION') {
    const location = window.location.href;
    try {
      source?.postMessage({ action: 'GET_LOCATION_RESPONSE', location }, origin || '*');
    } catch {
      // Ignore postMessage transmission failures
    }
  }
});

window.addEventListener('toolactivated', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" started execution.`);
});

window.addEventListener('toolcancel', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" execution is cancelled.`);
});
