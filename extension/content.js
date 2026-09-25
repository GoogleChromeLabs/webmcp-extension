/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

console.debug(`[WebMCP] Content script injected in ${window.location.href}`);

const BUILT_IN_PAGE_TOOLS = [
  {
    name: 'read_page_content',
    description: 'Read the title, URL, outline, and visible text content of the current web page.',
    inputSchema: {
      type: 'object',
      properties: {
        maxCharacters: {
          type: 'number',
          description: 'Maximum characters to retrieve (default 12000, max 30000)',
        },
      },
    },
    readOnlyHint: true,
    untrustedContentHint: true,
    frameId: 0,
  },
  {
    name: 'query_dom_elements',
    description: 'Query specific elements on the current page using a CSS selector to inspect tables, lists, forms, or text sections.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector (e.g. "table", "h1, h2, h3", "article", ".product-specs", "form")',
        },
      },
      required: ['selector'],
    },
    readOnlyHint: true,
    untrustedContentHint: true,
    frameId: 0,
  },
];

function executeReadPageContent(args) {
  const maxCharacters = Math.min(
    Math.max(Number(args?.maxCharacters) || 12000, 500),
    30000,
  );

  const title = document?.title || '';
  const url = window?.location?.href || '';
  const description =
    document?.querySelector?.('meta[name="description"]')?.getAttribute?.('content') ||
    document?.querySelector?.('meta[property="og:description"]')?.getAttribute?.('content') ||
    '';

  const headings = document?.querySelectorAll
    ? Array.from(document.querySelectorAll('h1, h2, h3'))
        .slice(0, 30)
        .map((el) => {
          const tag = (el.tagName || '').toLowerCase();
          const text = (el.innerText || el.textContent || '').trim();
          return text ? `${tag}: ${text}` : null;
        })
        .filter(Boolean)
    : [];

  const mainEl =
    document?.querySelector?.('main, article, [role="main"]') ||
    document?.body ||
    null;

  let textContent = '';
  if (mainEl) {
    if (typeof mainEl.cloneNode === 'function') {
      const clone = mainEl.cloneNode(true);
      if (clone.querySelectorAll) {
        const removals = clone.querySelectorAll(
          'script, style, noscript, svg, nav, footer, iframe, template, [hidden], [aria-hidden="true"]',
        );
        removals.forEach((el) => el.remove?.());
      }
      textContent = clone.innerText || clone.textContent || '';
    } else {
      textContent = mainEl.innerText || mainEl.textContent || '';
    }
    textContent = textContent
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  const truncated = textContent.length > maxCharacters;
  const content = truncated
    ? textContent.slice(0, maxCharacters) + '\n... [content truncated]'
    : textContent;

  return {
    title,
    url,
    description: description || undefined,
    headingsOutline: headings.length > 0 ? headings : undefined,
    content,
    characterCount: content.length,
    totalCharacters: textContent.length,
    truncated,
  };
}

function executeQueryDomElements(args) {
  const selector = args?.selector;
  if (!selector || typeof selector !== 'string') {
    return { error: 'selector argument is required and must be a string' };
  }

  let elements = [];
  try {
    if (document?.querySelectorAll) {
      elements = Array.from(document.querySelectorAll(selector));
    }
  } catch (err) {
    return { error: `Invalid CSS selector: ${toMessage(err)}` };
  }

  const matches = elements.slice(0, 20).map((el, index) => {
    const attrs = {};
    for (const attr of ['id', 'class', 'name', 'type', 'href', 'src', 'alt', 'role', 'aria-label']) {
      if (typeof el?.hasAttribute === 'function' && el.hasAttribute(attr)) {
        attrs[attr] = el.getAttribute(attr);
      }
    }
    const text = (el?.innerText || el?.textContent || '').trim().slice(0, 500);
    return {
      index,
      tagName: (el?.tagName || '').toLowerCase(),
      attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      text: text || undefined,
    };
  });

  return {
    selector,
    totalFound: elements.length,
    showingCount: matches.length,
    results: matches,
  };
}

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
      console.debug(
        `[WebMCP] Execute tool "${name}" with ${JSON.stringify(inputArgs)} in ${window.location.href}`,
      );
      if (name === 'read_page_content') {
        reply(executeReadPageContent(inputArgs));
        return true;
      }
      if (name === 'query_dom_elements') {
        reply(executeQueryDomElements(inputArgs));
        return true;
      }

      if (!document.modelContext) {
        reply(JSON.stringify('WebMCP modelContext is not supported on this page'));
        return true;
      }

      let targetFrame, loadPromise;
      // Check if this tool is associated with a form target.
      // The tool name comes from the page, so it is compared as a value rather
      // than interpolated into a selector; there is then nothing to escape.
      const formTarget = [...document.forms].find(
        (form) => form.getAttribute('toolname') === name,
      )?.target;
      if (formTarget) {
        // May be null, e.g. for target="_blank"; the result then lives in a
        // new tab and the sidebar retrieves it from there.
        targetFrame = document.getElementsByName(formTarget)[0];
      }
      if (targetFrame) {
        loadPromise = new Promise((resolve) => {
          targetFrame.addEventListener('load', resolve, { once: true });
        });
      }
      // Execute the experimental tool
      document.modelContext
        .getTools()
        .then(async (tools) => {
          const tool = tools.find((t) => t.name === name && t.window === window);
          let result;
          try {
            result = await document.modelContext.executeTool(tool, inputArgs);
          } catch (e) {
            // TODO: Remove this when executeTool doesn't accept JSON stringified inputArgs anymore in Chrome Stable.
            if (e?.message?.startsWith('Failed to parse input')) {
              result = await document.modelContext.executeTool(tool, JSON.stringify(inputArgs));
            } else {
              throw e;
            }
          }
          return result;
        })
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
        // Not `({ message })`: a rejection can be a string, null, or a
        // DOMException from touching a cross-origin contentWindow, and
        // destructuring those throws again inside the handler.
        .catch((error) => reply(JSON.stringify(toMessage(error))));
      return true;
    }
    if (action == 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT') {
      console.debug(`[WebMCP] Get cross document script tool result in ${window.location.href}`);
      reply(document.querySelector('script[type="application/ld+json"]')?.textContent);
    }
  } catch (error) {
    console.debug('[WebMCP] Content script error:', error);
  }
});

/** Turns anything that can be thrown into a string safe to send over the wire. */
function toMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error?.message ?? error);
}

let timeout;
function debouncedListTools(fromOrigins) {
  clearTimeout(timeout);
  timeout = setTimeout(() => listTools(fromOrigins), 100);
}

async function listTools(fromOrigins) {
  const tools = [];
  if (window === window.top) {
    tools.push(...BUILT_IN_PAGE_TOOLS);
  }
  if (document?.modelContext?.getTools) {
    try {
      for (const tool of await document.modelContext.getTools({ fromOrigins })) {
        const frameId = tool.window == window ? 0 : await getFrameId(tool.window);
        if (tools.some((existing) => existing.name === tool.name && existing.frameId === frameId)) {
          continue;
        }
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
    } catch (e) {
      console.debug('[WebMCP] Failed to get tools from modelContext:', e);
    }
  }
  console.debug(`[WebMCP] Got ${tools.length} tools`, tools);
  chrome.runtime.sendMessage({ tools, url: window.location.href });
}

async function getFrameId(targetWindow) {
  await chrome.runtime.sendMessage({ action: 'INJECT_GET_FRAME_ID' });
  const promise = new Promise((resolve) => {
    let timeoutId;
    const listener = ({ source, data }) => {
      // `data` is attacker-controlled: any frame can post anything, including
      // null or a bare string, so never dereference it unguarded.
      if (source == targetWindow && data?.action === 'GET_FRAME_ID_RESPONSE') {
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

// TODO: Remove when window.ontoolactivated and window.ontoolcancel are removed in Chrome Stable.
const targetFor = (type, listener, options) =>
  (`on${type}` in (document.modelContext ?? {}) ? document.modelContext : window)
    .addEventListener(type, listener, options);

targetFor('toolactivated', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" started execution.`);
});

targetFor('toolcancel', ({ toolName }) => {
  console.debug(`[WebMCP] Tool "${toolName}" execution is cancelled.`);
});

if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'contentScriptReady' }).catch(() => {});
}
