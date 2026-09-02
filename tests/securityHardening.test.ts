/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedOrigin,
  validateAuthToken,
} from '../server/security.js';
import {
  callBackend,
  getAuthToken,
} from '../src/services/backendBridge.js';

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
  // Direct address bar navigation (no origin header)
  assert.equal(isAllowedOrigin(undefined, '/logs'), true);
  assert.equal(isAllowedOrigin(null, '/logs'), true);

  // Localhost origins
  assert.equal(isAllowedOrigin('http://localhost:3000', '/logs'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3000', '/logs'), true);

  // Extension origin
  assert.equal(isAllowedOrigin('chrome-extension://abcdef', '/logs'), true);

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

test('security - backendBridge includes X-WebMCP-Auth header when auth token is configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WEBMCP_AUTH_TOKEN;
  let capturedHeaders: Record<string, string> = {};

  try {
    process.env.WEBMCP_AUTH_TOKEN = 'unit-test-secret-token';
    assert.equal(getAuthToken(), 'unit-test-secret-token');

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        json: async () => ({ success: true }),
      } as Response;
    };

    await callBackend('/api/test', { test: true });

    assert.equal(capturedHeaders['X-WebMCP-Auth'], 'unit-test-secret-token');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
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

    // 7. Direct browser navigation to /logs (no Origin header) -> 200 OK
    const resLogsDirect = await fetch(`${baseUrl}/logs`);
    assert.equal(resLogsDirect.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

