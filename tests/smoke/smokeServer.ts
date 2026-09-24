/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';

/** A WebMCP tool registered by `/test-page`, as the side panel should list it. */
export interface TestPageTool {
  name: string;
  description: string;
}

/** Tools the test page registers by name, each with its own annotations. */
export const NAMED_TOOLS = {
  getFlights: { name: 'get_flights', description: 'Search available flights for a route' },
  bookFlight: { name: 'book_flight', description: 'Reserve a passenger seat on a flight' },
  deleteAccount: { name: 'delete_account', description: 'Permanently delete loyalty account and points' },
} as const satisfies Record<string, TestPageTool>;

/**
 * How many generic read-only tools the test page adds on top of the named ones.
 * They are never called. They exist so the WebMCPToolsDialogue list (max-height
 * 220px, about 24px per row) overflows and scrolls: at least 9 tools are needed.
 * 10 also makes the chip and badge count two digits.
 */
const EXTRA_TOOL_COUNT = 7;

const EXTRA_TOOLS: TestPageTool[] = Array.from({ length: EXTRA_TOOL_COUNT }, (_, idx) => ({
  name: `extra_travel_tool_${idx + 1}`,
  description: `Travel helper action #${idx + 1} for itinerary management`,
}));

/** Every tool the test page registers, in registration order. */
export const TEST_PAGE_TOOLS: readonly TestPageTool[] = [
  NAMED_TOOLS.getFlights,
  NAMED_TOOLS.bookFlight,
  NAMED_TOOLS.deleteAccount,
  ...EXTRA_TOOLS,
];

/** Total number of WebMCP tools exposed by `/test-page`. */
export const TEST_PAGE_TOOL_COUNT = TEST_PAGE_TOOLS.length;

export interface ChatTurnReply {
  chatId?: string;
  text?: string;
  textChunks?: string[];
  functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
}

/** What the side panel sends back to the model after running (or refusing) a tool. */
export interface FunctionResponse {
  id: string;
  name: string;
  response: { result?: unknown; error?: string };
}

/** Body of a POST to `/api/chat`, as far as the smoke tests inspect it. */
export interface ChatRequestBody {
  message?: string;
  chatId?: string;
  toolResponses?: Array<{ functionResponse: FunctionResponse }>;
  /** The tools the side panel declared to the model for this turn. */
  tools?: Array<{ name: string; description: string }>;
  [key: string]: unknown;
}

/** Body of a POST to `/api/chat/reset`. */
export interface ResetRequestBody {
  chatId?: string;
  [key: string]: unknown;
}

export interface SmokeServer {
  baseUrl: string;
  /** Same handler on another port, so pages loaded from it are cross-origin to `baseUrl`. */
  frameBaseUrl: string;
  chatRequests: ChatRequestBody[];
  resetRequests: ResetRequestBody[];
  enqueueReplies: (...replies: ChatTurnReply[]) => void;
  /** Queued replies no `/api/chat` request has consumed yet. */
  pendingReplyCount: () => number;
  /** Resolves once at least one `/api/chat/reset` request has arrived. */
  waitForResetRequest: () => Promise<void>;
  close: () => Promise<void>;
}

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>WebMCP Smoke Test Travel Portal</title>
  </head>
  <body>
    <h1>WebMCP Smoke Test Page</h1>
    <script type="module">
      // Every tool call the page executes, read by the smoke tests.
      window.__executedTools = [];
      const recordCall = (name, args) => {
        window.__executedTools.push({ name, args });
      };

      await document.modelContext.registerTool({
        name: ${JSON.stringify(NAMED_TOOLS.getFlights.name)},
        description: ${JSON.stringify(NAMED_TOOLS.getFlights.description)},
        inputSchema: {
          type: 'object',
          properties: { destination: { type: 'string' } },
        },
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: false,
          consequentialHint: false,
        },
        execute: async (inputArgs) => {
          recordCall(${JSON.stringify(NAMED_TOOLS.getFlights.name)}, inputArgs);
          return {
            flights: [{ code: 'WM101', destination: inputArgs?.destination || 'Tokyo', price: '$650' }],
          };
        },
      });

      await document.modelContext.registerTool({
        name: ${JSON.stringify(NAMED_TOOLS.bookFlight.name)},
        description: ${JSON.stringify(NAMED_TOOLS.bookFlight.description)},
        inputSchema: {
          type: 'object',
          properties: { flightCode: { type: 'string' } },
        },
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false,
          consequentialHint: false,
        },
        execute: async (inputArgs) => {
          recordCall(${JSON.stringify(NAMED_TOOLS.bookFlight.name)}, inputArgs);
          return {
            status: 'confirmed',
            confirmationCode: 'CONF-' + (inputArgs?.flightCode || 'WM101'),
            flightCode: inputArgs?.flightCode || 'WM101',
          };
        },
      });

      await document.modelContext.registerTool({
        name: ${JSON.stringify(NAMED_TOOLS.deleteAccount.name)},
        description: ${JSON.stringify(NAMED_TOOLS.deleteAccount.description)},
        inputSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
        },
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false,
          consequentialHint: true,
        },
        execute: async (inputArgs) => {
          recordCall(${JSON.stringify(NAMED_TOOLS.deleteAccount.name)}, inputArgs);
          return { deleted: true };
        },
      });

      for (const extra of ${JSON.stringify(EXTRA_TOOLS)}) {
        await document.modelContext.registerTool({
          name: extra.name,
          description: extra.description,
          inputSchema: { type: 'object', properties: {} },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: false,
            consequentialHint: false,
          },
          execute: async (inputArgs) => {
            recordCall(extra.name, inputArgs);
            return { ok: true };
          },
        });
      }

      window.__toolsRegistered = true;
    </script>
  </body>
</html>`;

/** The tool registered inside the cross-origin iframe of `/frame-host`. */
export const FRAME_TOOL = {
  name: 'frame_echo',
  description: 'Echo text back from inside an embedded frame',
} as const satisfies TestPageTool;

/** A page with no tools of its own, embedding `/frame-tool` from another origin. */
function frameHostHtml(frameBaseUrl: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>WebMCP Smoke Test Frame Host</title></head>
  <body>
    <h1>WebMCP Smoke Test Frame Host</h1>
    <!-- Cross-origin frames may only register tools when allowed to by permissions policy. -->
    <iframe src="${frameBaseUrl}/frame-tool" allow="tools" title="Embedded tool frame"></iframe>
  </body>
</html>`;
}

const FRAME_TOOL_HTML = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>WebMCP Smoke Test Frame Tool</title></head>
  <body>
    <script type="module">
      window.__executedTools = [];
      await document.modelContext.registerTool({
        name: ${JSON.stringify(FRAME_TOOL.name)},
        description: ${JSON.stringify(FRAME_TOOL.description)},
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
        execute: async (inputArgs) => {
          window.__executedTools.push({ name: ${JSON.stringify(FRAME_TOOL.name)}, args: inputArgs });
          return { echoed: inputArgs?.text ?? '', from: location.origin };
        },
      // A cross-origin tool is only listed to the origins it is exposed to.
      }, { exposedTo: [location.ancestorOrigins[0]] });
      window.__toolsRegistered = true;
    </script>
  </body>
</html>`;

/**
 * Starts a local HTTP server that:
 * 1. Serves a test web page at `/test-page` with `document.modelContext` exposing
 *    read-only, write, and consequential WebMCP tools.
 * 2. Serves `/frame-host`, which embeds `/frame-tool` from a second port, so
 *    its one tool lives in a cross-origin iframe.
 * 3. Implements `/api/chat` (NDJSON streaming) and `/api/chat/reset` with
 *    `X-WebMCP-Auth` header validation so the extension side panel can make real
 *    network calls.
 */
export async function startSmokeServer(authToken: string): Promise<SmokeServer> {
  const chatRequests: ChatRequestBody[] = [];
  const resetRequests: ResetRequestBody[] = [];
  const replyQueue: ChatTurnReply[] = [];
  const resetListeners: Array<() => void> = [];

  let frameBaseUrl = '';
  const handler: http.RequestListener = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WebMCP-Auth');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const pages: Record<string, () => string> = {
      '/test-page': () => TEST_PAGE_HTML,
      '/frame-host': () => frameHostHtml(frameBaseUrl),
      '/frame-tool': () => FRAME_TOOL_HTML,
    };
    const page = req.method === 'GET' && req.url ? pages[req.url] : undefined;
    if (page) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page());
      return;
    }

    if (req.method === 'POST' && (req.url === '/api/chat' || req.url === '/api/chat/reset')) {
      const providedToken = req.headers['x-webmcp-auth'];
      if (providedToken !== authToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid X-WebMCP-Auth' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let body: ChatRequestBody;
        try {
          body = chunks.length
            ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequestBody)
            : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body is not valid JSON' }));
          return;
        }

        if (req.url === '/api/chat/reset') {
          resetRequests.push(body);
          resetListeners.splice(0).forEach((notify) => notify());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        chatRequests.push(body);
        const nextReply = replyQueue.shift() || {
          chatId: body.chatId || 'smoke-chat-1',
          text: 'Default smoke reply.',
          functionCalls: [],
        };

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        const streamParts = nextReply.textChunks || (nextReply.text ? [nextReply.text] : []);
        // Like the real server: each line carries only the new piece of text.
        for (const chunk of streamParts) {
          res.write(JSON.stringify({ delta: chunk }) + '\n');
        }
        const finalText = nextReply.text ?? streamParts.join('');
        res.write(
          JSON.stringify({
            done: true,
            chatId: nextReply.chatId || body.chatId || 'smoke-chat-1',
            text: finalText,
            functionCalls: (nextReply.functionCalls || []).map((call, idx) => ({
              id: call.id || `call_${Date.now()}_${idx}`,
              name: call.name,
              args: call.args || {},
            })),
          }) + '\n'
        );
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  };

  const server = http.createServer(handler);
  const frameServer = http.createServer(handler);
  const listen = async (srv: http.Server): Promise<string> => {
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const address = srv.address();
    if (!address || typeof address !== 'object') {
      throw new Error(`Smoke server did not report a TCP address (got ${String(address)})`);
    }
    return `http://127.0.0.1:${address.port}`;
  };
  const closeServer = (srv: http.Server) =>
    new Promise<void>((resolve) => {
      srv.closeAllConnections();
      srv.close(() => resolve());
    });

  let baseUrl: string;
  try {
    baseUrl = await listen(server);
    frameBaseUrl = await listen(frameServer);
  } catch (err) {
    await Promise.all([closeServer(server), closeServer(frameServer)]);
    throw err;
  }

  return {
    baseUrl,
    frameBaseUrl,
    chatRequests,
    resetRequests,
    enqueueReplies: (...replies: ChatTurnReply[]) => {
      replyQueue.push(...replies);
    },
    pendingReplyCount: () => replyQueue.length,
    waitForResetRequest: () =>
      resetRequests.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => resetListeners.push(resolve)),
    close: async () => {
      await Promise.all([closeServer(server), closeServer(frameServer)]);
    },
  };
}
