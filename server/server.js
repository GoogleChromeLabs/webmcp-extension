/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

import { streamText } from 'ai';

import { buildSystemInstruction } from '../shared/systemPrompt.js';
import { describeModel, loadProviders } from './providers.js';
import { appendTurnMessages, buildTools, hasPendingToolCalls } from './tools.js';
import {
  loadDotEnv,
  getEnv,
  ensureAuthToken,
  isAllowedOrigin,
  validateAuthToken,
  authorizeLogsRequest,
  createLogsSession,
  buildLogsSessionCookie,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

const env = loadDotEnv(envPath);
const authToken = ensureAuthToken(env, envPath);
const allowedExtensionId = getEnv(env, 'ALLOWED_EXTENSION_ID');

/**
 * Which provider and model answer a turn is settled here, from `.env`, and is
 * never taken from the side panel. Set `MODEL=openai:gpt-4o`,
 * `MODEL=anthropic:claude-sonnet-4-5` or `MODEL=google:gemini-3.6-flash`; a
 * bare model name is read as Google's, so older `.env` files still work.
 */
const providerConfig = loadProviders(env);
const activeModel = describeModel(providerConfig);
const languageModel = providerConfig.model;

if (providerConfig.problem) {
  console.error(`⚠️  ${providerConfig.problem}`);
} else {
  console.log(`🤖 Answering with ${activeModel}`);
}

const MAX_CHAT_SESSIONS = 100;
/**
 * Each chat's conversation. Map order is insertion order, so the first key is
 * the least recently used chat, the one to evict.
 *
 * @type {Map<string, import('ai').ModelMessage[]>}
 */
const chatSessions = new Map();
/** @type {Array<Record<string, unknown>>} */
const logs = [];
/** @type {Set<http.ServerResponse>} Open log dashboard streams. */
const logClients = new Set();

// Log entries contain full prompts and scraped page content. The dashboard is
// authenticated, but set WEBMCP_LOG_REDACT_BODIES=1 to keep bodies out of the
// in-memory buffer altogether (useful when screen-sharing or recording demos).
const redactLogBodies = /^(1|true|yes)$/i.test(getEnv(env, 'WEBMCP_LOG_REDACT_BODIES') ?? '');

const REDACTED_NOTICE = '[redacted: WEBMCP_LOG_REDACT_BODIES is enabled]';

/**
 * Keeps a request in the log buffer and sends it to open dashboards.
 *
 * @param {{ startTime?: number, [key: string]: unknown }} logEntry
 */
function recordServerLog(logEntry) {
  const { startTime, ...rest } = logEntry;
  const durationMs = startTime ? Math.round(performance.now() - startTime) : 0;
  /** @type {Record<string, unknown>} */
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    ...rest,
  };

  if (redactLogBodies) {
    if (entry.requestPayload !== undefined && entry.requestPayload !== null) {
      entry.requestPayload = REDACTED_NOTICE;
    }
    if (entry.responsePayload !== undefined && entry.responsePayload !== null) {
      entry.responsePayload = REDACTED_NOTICE;
    }
  }

  logs.push(entry);
  if (logs.length > 500) {
    logs.shift();
  }
  const eventData = `data: ${JSON.stringify({ type: 'log', log: entry })}\n\n`;
  for (const clientRes of logClients) {
    try {
      clientRes.write(eventData);
    } catch {
      logClients.delete(clientRes);
    }
  }
  return entry;
}

/**
 * Untrusted tool results reach this server Base64-encoded by the side panel
 * (see applySpotlighting in src/sidepanel/services/toolResults.ts).
 */
const SPOTLIGHTING = {
  format: 'Base64-encoded',
  howToRead: 'Decode the base64 data',
};

/** Largest accepted JSON request body, in bytes. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Builds an Error the request handler can turn into a specific status code.
 *
 * @param {number} statusCode
 * @param {string} message
 */
function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * The body of a chat request. It comes from the network, so every field is
 * checked before use.
 *
 * @typedef {object} ChatRequestBody
 * @property {string} [chatId]
 * @property {unknown} [message]
 * @property {import('./tools.js').ToolResponse[]} [toolResponses]
 * @property {import('./tools.js').ToolDeclaration[]} [tools]
 */

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<ChatRequestBody>}
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    /** @param {Error} err */
    const fail = (err) => {
      if (settled) return;
      settled = true;
      // Stop reading, but leave the socket open so the handler can still
      // write a response instead of the client seeing a connection reset.
      req.pause();
      reject(err);
    };

    req.on('data', (/** @type {Buffer} */ chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(httpError(413, `Request body exceeds the ${MAX_BODY_BYTES} byte limit.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => fail(httpError(400, 'Could not read the request body.')));

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(httpError(400, 'Request body is not valid JSON.'));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const origin = req.headers.origin;
  const isAllowed = isAllowedOrigin(origin, url.pathname, allowedExtensionId);

  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WebMCP-Auth, Authorization');
  }

  if (req.method === 'OPTIONS') {
    if (!isAllowed) {
      console.warn(`  🚫 Blocked CORS preflight from unauthorized origin: "${origin || 'none'}" to ${url.pathname}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: Origin is not authorized' }));
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`\n📥 [${req.method}] ${url.pathname} (origin: ${origin || 'none'})`);

  // Declared before the try so the catch block can always read it; when this
  // lived inside the try, an early throw made the error handler itself throw.
  const startTime = performance.now();

  try {
    if (url.pathname.startsWith('/api/')) {
      // 1. Origin verification
      if (!isAllowed) {
        console.warn(`  🚫 Blocked API request from unauthorized origin: "${origin || 'none'}"`);
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 403,
          error: `Forbidden: Origin "${origin || 'none'}" is not an authorized Chrome extension.`,
        });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Request origin is not an authorized Chrome extension.' }));
        return;
      }

      // 2. Auth token verification
      if (!validateAuthToken(req.headers, authToken)) {
        // Deliberately does not echo the rejected value: it is attacker
        // supplied, and these logs get screen-shared and pasted into issues.
        console.warn('  🔒 Unauthorized API request: missing or invalid WebMCP auth token.');
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 401,
          error: 'Unauthorized: Missing or invalid WebMCP auth token.',
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid WebMCP auth token.' }));
        return;
      }
    }

    if (url.pathname === '/logs' && req.method === 'GET') {
      if (!isAllowed) {
        console.warn(`  🚫 Blocked /logs request from unauthorized origin: "${origin || 'none'}"`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Origin is not authorized to access logs.' }));
        return;
      }

      // An absent Origin header is trivially forged by any local process, so the
      // origin check above is not sufficient on its own. Require a token or an
      // established dashboard session.
      const queryToken = url.searchParams.get('token');
      const { authorized, viaSession } = authorizeLogsRequest(
        { headers: req.headers, queryToken },
        authToken
      );

      if (!authorized) {
        console.warn('  🔒 Blocked unauthenticated /logs request.');
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            error:
              'Unauthorized: the log dashboard requires an auth token. Open the URL printed by the server on startup, or append ?token=<WEBMCP_AUTH_TOKEN>.',
          })
        );
        return;
      }

      // Exchange a valid token for an HttpOnly session cookie so the token stops
      // travelling in URLs (and out of browser history / referrers).
      if (!viaSession) {
        res.setHeader('Set-Cookie', buildLogsSessionCookie(createLogsSession()));
      }

      if (queryToken) {
        const cleanUrl = new URL(url);
        cleanUrl.searchParams.delete('token');
        res.writeHead(302, {
          Location: `${cleanUrl.pathname}${cleanUrl.search}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        res.end();
        return;
      }

      const noStoreHeaders = {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      };

      if (url.searchParams.get('stream') === 'true') {
        res.writeHead(200, {
          ...noStoreHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.socket?.setNoDelay(true);
        res.write(`data: ${JSON.stringify({ type: 'init', logs })}\n\n`);
        logClients.add(res);
        req.on('close', () => {
          logClients.delete(res);
        });
        return;
      }

      if (url.searchParams.get('json') === 'true') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...noStoreHeaders });
        res.end(JSON.stringify({ logs }));
        return;
      }

      // Log payloads are attacker-controlled (tool names and results come from
      // arbitrary pages). A nonce-based CSP means that even if an escaping bug
      // slipped through, injected markup could not execute or phone home.
      const nonce = randomBytes(16).toString('base64');
      const html = fs
        .readFileSync(path.join(__dirname, 'logs.html'), 'utf-8')
        .replaceAll('__CSP_NONCE__', nonce);

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': [
          "default-src 'none'",
          `script-src 'nonce-${nonce}'`,
          "style-src 'unsafe-inline'",
          "connect-src 'self'",
          "img-src 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
        ].join('; '),
        ...noStoreHeaders,
      });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/chat/reset' && req.method === 'POST') {
      const { chatId } = await parseJsonBody(req);
      if (chatId) {
        chatSessions.delete(chatId);
      } else {
        chatSessions.clear();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { message, toolResponses, tools, chatId } = await parseJsonBody(req);

      if (!languageModel) {
        const problem = providerConfig.problem || 'No model is configured on the backend server.';
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 400,
          startTime,
          error: problem,
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: problem }));
        return;
      }

      if (message === undefined && (!Array.isArray(toolResponses) || toolResponses.length === 0)) {
        const problem = 'A chat turn needs either a `message` or `toolResponses`.';
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 400,
          startTime,
          error: problem,
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: problem }));
        return;
      }

      const currentChatId = chatId || randomUUID();
      let baseHistory = chatSessions.get(currentChatId);

      if (message === undefined && !hasPendingToolCalls(baseHistory)) {
        // Tool results with no call to answer: the server restarted or the
        // chat was evicted. Say so, rather than let the provider reject it.
        const problem = 'This chat is no longer on the server. Start a new chat.';
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 409,
          startTime,
          error: problem,
        });
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: problem }));
        return;
      }

      if (!baseHistory) {
        if (chatSessions.size >= MAX_CHAT_SESSIONS) {
          const oldestKey = chatSessions.keys().next().value;
          if (oldestKey !== undefined) chatSessions.delete(oldestKey);
        }
        baseHistory = [];
      }

      const nextHistory = appendTurnMessages(baseHistory, { message, toolResponses });
      chatSessions.delete(currentChatId);
      chatSessions.set(currentChatId, nextHistory);

      if (tools && tools.length > 0) {
        console.log(`  Tools provided (${tools.length}):`, tools.map((t) => t.name).join(', '));
      }
      console.log(`  Answering a turn of ${nextHistory.length} message(s) with "${activeModel}"`);

      const clientGone = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) clientGone.abort();
      });

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.socket?.setNoDelay(true);

      let fullText = '';
      try {
        const result = streamText({
          model: languageModel,
          system: buildSystemInstruction(SPOTLIGHTING),
          messages: nextHistory,
          tools: buildTools(tools),
          abortSignal: clientGone.signal,
        });

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            // Only the new text goes out; the side panel joins the pieces.
            fullText += part.text;
            res.write(`${JSON.stringify({ delta: part.text })}\n`);
          } else if (part.type === 'error') {
            throw part.error;
          }
        }

        const [response, rawToolCalls] = await Promise.all([result.response, result.toolCalls]);
        const functionCalls = rawToolCalls.map((call) => ({
          id: call.toolCallId,
          name: call.toolName,
          args: call.input ?? {},
        }));

        if (!clientGone.signal.aborted && chatSessions.get(currentChatId) === nextHistory) {
          chatSessions.delete(currentChatId);
          chatSessions.set(currentChatId, [...nextHistory, ...response.messages]);
        }

        const finalPayload = {
          done: true,
          chatId: currentChatId,
          text: fullText,
          functionCalls,
        };
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 200,
          startTime,
          requestPayload: { chatId: currentChatId, message, toolResponses, tools },
          responsePayload: finalPayload,
        });
        res.end(`${JSON.stringify(finalPayload)}\n`);
      } catch (err) {
        if (chatSessions.get(currentChatId) === nextHistory) {
          const partial = fullText.trim();
          if (clientGone.signal.aborted && partial) {
            chatSessions.set(currentChatId, [
              ...nextHistory,
              { role: 'assistant', content: [{ type: 'text', text: partial }] },
            ]);
          } else if (baseHistory.length === 0) {
            chatSessions.delete(currentChatId);
          } else {
            chatSessions.set(currentChatId, baseHistory);
          }
        }
        if (clientGone.signal.aborted) {
          console.log('  Stopped: the side panel closed the connection.');
          res.end();
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('  Streaming error:', errMsg);
        recordServerLog({
          method: req.method,
          path: url.pathname,
          statusCode: 500,
          startTime,
          requestPayload: { chatId: currentChatId, message, toolResponses, tools },
          error: errMsg,
        });
        res.end(
          `${JSON.stringify({
            error: 'Something went wrong while processing your request. The error details have been logged.',
          })}\n`
        );
      }
      return;
    }

    console.warn(`  404 Not Found: ${url.pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    const detail = (error instanceof Error && error.message) || String(error);
    // Only errors this file created with httpError() carry a status code, and
    // it is validated here because an out-of-range value would make writeHead
    // throw inside the catch, which would take the process down.
    const tagged = /** @type {{ statusCode?: unknown } | null} */ (error)?.statusCode;
    const statusCode =
      typeof tagged === 'number' && Number.isInteger(tagged) && tagged >= 400 && tagged <= 499 ? tagged : 500;

    // A 4xx is the caller's own malformed request, so echoing the reason is
    // useful and safe. A 5xx stays generic: it can carry upstream API text or
    // filesystem paths.
    const clientMessage =
      statusCode >= 500 ? 'Internal server error. Check the server console for details.' : detail;

    if (statusCode >= 500) {
      console.error('  Server error:', detail);
    } else {
      console.warn(`  ${statusCode} Bad request: ${detail}`);
    }

    recordServerLog({
      method: req.method,
      path: url.pathname,
      statusCode,
      startTime,
      error: detail,
    });
    if (!res.headersSent) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: clientMessage }));
  }
});

// loadDotEnv preserves keys verbatim, so these match the uppercase names the
// README documents. Do not add lowercase fallbacks: scripts/build.js reads the
// uppercase keys, so accepting both here would let the server and the bundled
// side panel disagree about the port with nothing to signal it.
const HOST = getEnv(env, 'HOST') || '127.0.0.1';
const PORT = getEnv(env, 'PORT') || '3000';
server.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Backend model server listening on http://${HOST}:${PORT}`);
  console.log(
    `📊 Log dashboard: http://${HOST}:${PORT}/logs?token=${encodeURIComponent(authToken)}`
  );
  console.log('   (the token is exchanged for a session cookie and stripped from the URL)');
  if (redactLogBodies) {
    console.log('   WEBMCP_LOG_REDACT_BODIES is on — request/response bodies will not be logged.');
  }
});
