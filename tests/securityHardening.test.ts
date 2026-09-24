/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedOrigin,
  validateAuthToken,
  timingSafeEqualStrings,
  parseCookies,
  authorizeLogsRequest,
  createLogsSession,
  hasValidLogsSession,
  buildLogsSessionCookie,
  LOGS_SESSION_COOKIE,
} from '../server/security.js';
import {
  streamChat,
} from '../src/sidepanel/services/backendBridge.js';

test('security - isAllowedOrigin rejects untrusted web origins for /api endpoints', () => {
  assert.equal(isAllowedOrigin('https://evil.com', '/api/chat'), false);
  assert.equal(isAllowedOrigin('http://attacker.org:8080', '/api/model'), false);
  assert.equal(isAllowedOrigin('http://localhost:8000', '/api/reset'), false);
  assert.equal(isAllowedOrigin('', '/api/chat'), false);
  assert.equal(isAllowedOrigin(null, '/api/chat'), false);
  assert.equal(isAllowedOrigin(undefined, '/api/chat'), false);
});

test('security - isAllowedOrigin permits chrome-extension origins for /api endpoints', () => {
  assert.equal(
    isAllowedOrigin('chrome-extension://abcdefghijklmnop', '/api/chat'),
    true
  );
  assert.equal(
    isAllowedOrigin('chrome-extension://xyz1234567890', '/api/model'),
    true
  );
});

test('security - isAllowedOrigin enforces allowedExtensionId when configured', () => {
  const trustedId = 'specific-extension-id';
  assert.equal(
    isAllowedOrigin(`chrome-extension://${trustedId}`, '/api/chat', trustedId),
    true
  );
  assert.equal(
    isAllowedOrigin('chrome-extension://rogue-extension-id', '/api/chat', trustedId),
    false
  );
});

test('security - isAllowedOrigin permits same-origin and browser navigation for /logs', () => {
  // Direct address bar navigation (no origin header). Allowed at the origin
  // layer only; authorizeLogsRequest still demands a token or session.
  assert.equal(isAllowedOrigin(undefined, '/logs'), true);
  assert.equal(isAllowedOrigin(null, '/logs'), true);

  // Localhost origins (the dashboard's own fetch/EventSource calls)
  assert.equal(isAllowedOrigin('http://localhost:3000', '/logs'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3000', '/logs'), true);

  // The extension never calls /logs, so extension origins are refused.
  assert.equal(isAllowedOrigin('chrome-extension://abcdef', '/logs'), false);

  // External malicious web pages requesting logs
  assert.equal(isAllowedOrigin('https://evil.com', '/logs'), false);
});

test('security - validateAuthToken verifies X-WebMCP-Auth and Bearer authorization', () => {
  const secret = 'my-super-secret-token-123';

  // Valid header: X-WebMCP-Auth
  assert.equal(
    validateAuthToken({ 'x-webmcp-auth': secret }, secret),
    true
  );

  // Valid header: Authorization Bearer
  assert.equal(
    validateAuthToken({ authorization: `Bearer ${secret}` }, secret),
    true
  );

  // Invalid token
  assert.equal(
    validateAuthToken({ 'x-webmcp-auth': 'wrong-token' }, secret),
    false
  );

  // Missing token
  assert.equal(validateAuthToken({}, secret), false);
  assert.equal(validateAuthToken({ 'x-webmcp-auth': '' }, secret), false);
});

test('security - validateAuthToken fails closed when the server has no token configured', () => {
  // A misconfigured server must reject everything rather than silently
  // accepting unauthenticated requests.
  assert.equal(validateAuthToken({ 'x-webmcp-auth': 'anything' }, ''), false);
  assert.equal(validateAuthToken({ 'x-webmcp-auth': 'anything' }, null), false);
  assert.equal(validateAuthToken({ 'x-webmcp-auth': 'anything' }, undefined), false);
});

test('security - timingSafeEqualStrings compares without throwing on length mismatch', () => {
  assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
  assert.equal(timingSafeEqualStrings('abc', 'abd'), false);
  // Differing lengths must return false, not throw.
  assert.equal(timingSafeEqualStrings('short', 'a-much-longer-value'), false);
  assert.equal(timingSafeEqualStrings('', ''), false);
  assert.equal(timingSafeEqualStrings(undefined as never, 'x'), false);
});

test('security - parseCookies handles absent, malformed and multi-value headers', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies('novalue'), {});
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseCookies('  spaced = value  '), { spaced: 'value' });
});

test('security - authorizeLogsRequest requires a token and then accepts the issued session', () => {
  const secret = 'logs-dashboard-secret';

  // No credentials at all -> rejected (this is the local-process bypass).
  assert.equal(authorizeLogsRequest({ headers: {} }, secret).authorized, false);

  // Wrong token -> rejected.
  assert.equal(
    authorizeLogsRequest({ headers: {}, queryToken: 'nope' }, secret).authorized,
    false
  );

  // Correct token via query param -> authorized, but not yet via session.
  const viaToken = authorizeLogsRequest({ headers: {}, queryToken: secret }, secret);
  assert.equal(viaToken.authorized, true);
  assert.equal(viaToken.viaSession, false);

  // Correct token via header -> also authorized.
  assert.equal(
    authorizeLogsRequest({ headers: { 'x-webmcp-auth': secret } }, secret).authorized,
    true
  );

  // The issued session cookie authorizes subsequent requests on its own.
  const sessionId = createLogsSession();
  const viaSession = authorizeLogsRequest(
    { headers: { cookie: `${LOGS_SESSION_COOKIE}=${sessionId}` } },
    secret
  );
  assert.equal(viaSession.authorized, true);
  assert.equal(viaSession.viaSession, true);

  // A forged session id is rejected.
  assert.equal(
    authorizeLogsRequest(
      { headers: { cookie: `${LOGS_SESSION_COOKIE}=deadbeef` } },
      secret
    ).authorized,
    false
  );
});

test('security - log session cookie is HttpOnly, SameSite=Strict and scoped to /logs', () => {
  const cookie = buildLogsSessionCookie('abc123');
  assert.match(cookie, /^webmcp_logs_session=abc123/);
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Strict'));
  assert.ok(cookie.includes('Path=/logs'));
});

test('security - expired log sessions are rejected', () => {
  const sessionId = createLogsSession();
  const cookieHeader = `${LOGS_SESSION_COOKIE}=${sessionId}`;

  assert.equal(hasValidLogsSession(cookieHeader), true);
  // Thirteen hours later the 12h TTL has lapsed.
  assert.equal(hasValidLogsSession(cookieHeader, Date.now() + 13 * 60 * 60 * 1000), false);
});

test('security - log dashboard renders payloads without innerHTML or inline handlers', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Tests are bundled into dist/tests, so resolve the source tree from cwd.
  const dashboard = fs.readFileSync(
    path.resolve(process.cwd(), 'server/logs.html'),
    'utf-8'
  );

  // Log entries contain tool names and results supplied by arbitrary web pages.
  // Assigning them through innerHTML is how the stored XSS arose.
  assert.equal(
    /\.innerHTML\s*=/.test(dashboard),
    false,
    'logs.html must not assign to innerHTML'
  );
  assert.equal(
    /\.outerHTML\s*=/.test(dashboard),
    false,
    'logs.html must not assign to outerHTML'
  );
  assert.equal(
    /insertAdjacentHTML/.test(dashboard),
    false,
    'logs.html must not use insertAdjacentHTML'
  );

  // Inline handlers are blocked by the nonce-based CSP, so their presence would
  // mean a silently broken dashboard as well as a weaker policy.
  assert.equal(
    /\son[a-z]+\s*=\s*"/.test(dashboard),
    false,
    'logs.html must not use inline on* event handler attributes'
  );

  // The server substitutes this placeholder with a per-response nonce.
  assert.ok(
    /<script [^>]*nonce="__CSP_NONCE__">/.test(dashboard),
    'logs.html script tag must carry the CSP nonce placeholder'
  );
});

test('security - backendBridge includes X-WebMCP-Auth header when auth token is configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WEBMCP_AUTH_TOKEN;
  let capturedHeaders = new Headers();

  try {
    process.env.WEBMCP_AUTH_TOKEN = 'unit-test-secret-token';

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('{"done":true,"text":"","functionCalls":[]}\n', {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    };

    await streamChat('/api/chat', { test: true });

    assert.equal(capturedHeaders.get('X-WebMCP-Auth'), 'unit-test-secret-token');
    assert.equal(capturedHeaders.get('Content-Type'), 'application/json');

    // The headers are the bridge's own: callers cannot pass any, which the
    // types refuse, and the ones a request carries do not depend on what a
    // caller puts in its options.
    await streamChat('/api/chat', { test: true }, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    assert.equal(capturedHeaders.get('X-WebMCP-Auth'), 'unit-test-secret-token');
    assert.equal(capturedHeaders.get('Content-Type'), 'application/json');
  } finally {
    if (originalToken !== undefined) {
      process.env.WEBMCP_AUTH_TOKEN = originalToken;
    } else {
      delete process.env.WEBMCP_AUTH_TOKEN;
    }
    globalThis.fetch = originalFetch;
  }
});

test('security - HTTP server integration rejects unauthorized web origins and requires auth token', async () => {
  const http = await import('node:http');
  const testSecret = 'test-secret-token-456';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const origin = req.headers.origin;
    const isAllowed = isAllowedOrigin(origin, url.pathname);

    if (isAllowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WebMCP-Auth, Authorization');
    }

    if (req.method === 'OPTIONS') {
      if (!isAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!isAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Origin is not authorized' }));
        return;
      }
      if (!validateAuthToken(req.headers, testSecret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (url.pathname.startsWith('/logs')) {
      if (!isAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      const { authorized, viaSession } = authorizeLogsRequest(
        { headers: req.headers, queryToken: url.searchParams.get('token') },
        testSecret
      );
      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      if (!viaSession) {
        res.setHeader('Set-Cookie', buildLogsSessionCookie(createLogsSession()));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: [] }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Web origin CORS preflight OPTIONS to /api/chat -> 403 Forbidden
    const resPreflightEvil = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    assert.equal(resPreflightEvil.status, 403);

    // 2. Extension CORS preflight OPTIONS to /api/chat -> 204 No Content with CORS origin header
    const resPreflightExtension = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://test-ext-id' },
    });
    assert.equal(resPreflightExtension.status, 204);
    assert.equal(
      resPreflightExtension.headers.get('Access-Control-Allow-Origin'),
      'chrome-extension://test-ext-id'
    );
    assert.ok(
      resPreflightExtension.headers.get('Access-Control-Allow-Headers')?.includes('X-WebMCP-Auth')
    );

    // 3. Web origin direct POST to /api/chat -> 403 Forbidden
    const resPostEvil = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'steal data' }),
    });
    assert.equal(resPostEvil.status, 403);

    // 4. Extension POST with missing token -> 401 Unauthorized
    const resPostMissingToken = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://test-ext-id',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.equal(resPostMissingToken.status, 401);

    // 5. Extension POST with valid token -> 200 OK
    const resPostValid = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://test-ext-id',
        'Content-Type': 'application/json',
        'X-WebMCP-Auth': testSecret,
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.equal(resPostValid.status, 200);
    const jsonValid = (await resPostValid.json()) as { success: boolean };
    assert.equal(jsonValid.success, true);

    // 6. Malicious web page accessing /logs -> 403 Forbidden
    const resLogsEvil = await fetch(`${baseUrl}/logs`, {
      headers: { Origin: 'https://evil.com' },
    });
    assert.equal(resLogsEvil.status, 403);

    // 7. Local process with no Origin header and no token -> 401 Unauthorized.
    // This is the bypass that previously exposed every logged prompt and page
    // payload to any process on the machine.
    const resLogsNoToken = await fetch(`${baseUrl}/logs`);
    assert.equal(resLogsNoToken.status, 401);

    // 8. Valid token -> 200 OK, and a scoped session cookie is issued.
    const resLogsToken = await fetch(`${baseUrl}/logs?token=${testSecret}`);
    assert.equal(resLogsToken.status, 200);
    const setCookie = resLogsToken.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('webmcp_logs_session='));
    assert.ok(setCookie.includes('HttpOnly'));

    // 9. The issued session cookie alone authorizes follow-up requests.
    const sessionCookie = setCookie.split(';')[0];
    const resLogsSession = await fetch(`${baseUrl}/logs?json=true`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(resLogsSession.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

