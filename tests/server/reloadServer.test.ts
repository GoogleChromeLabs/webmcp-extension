/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { createBuildOptions } from '../../scripts/buildConfig.ts';
import { startReloadServer } from '../../scripts/reloadServer.ts';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/** Connects the way the service worker does, and collects what it is sent. */
async function connect(url: string, origin = EXTENSION_ORIGIN) {
  const messages: string[] = [];
  // Node's WebSocket takes headers, which a browser's does not, so the test
  // can send the origin a real extension would.
  const socket = new WebSocket(url, { headers: { origin } } as unknown as string[]);
  socket.onmessage = ({ data }) => messages.push(String(data));
  const closed = new Promise<void>((resolve) => {
    socket.onclose = () => resolve();
  });
  const opened = await new Promise<boolean>((resolve) => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
  });
  return { opened, messages, closed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test('reloadServer - a worker connected to this npm run dev reloads after each build', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  const worker = await connect(server.url);
  assert.equal(worker.opened, true);
  await settle();
  assert.deepEqual(worker.messages, []);

  server.reload();
  await worker.closed;
  assert.deepEqual(worker.messages, ['reload']);
});

test('reloadServer - a worker from an earlier npm run dev reloads once this one has built', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  const staleUrl = server.url.replace(/build=[^&]+/, 'build=earlier-session');

  // Before the first build there is nothing new to load yet.
  const early = await connect(staleUrl);
  await settle();
  assert.deepEqual(early.messages, []);
  server.reload();
  await early.closed;
  assert.deepEqual(early.messages, ['reload']);

  const late = await connect(staleUrl);
  await late.closed;
  assert.deepEqual(late.messages, ['reload']);
});

test('reloadServer - build errors of any length reach connected workers', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  const worker = await connect(server.url);
  // One for each of the three WebSocket length encodings.
  const errors = [100, 1000, 70_000].map((length) => 'x'.repeat(length));
  for (const text of errors) server.reportErrors(text);
  await settle();
  assert.deepEqual(worker.messages, errors);
});

test('reloadServer - a worker that connects while the build is failing gets the errors', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  server.reportErrors('extension/background.ts:1:6: ERROR: Expected identifier');
  const during = await connect(server.url);
  await settle();
  assert.deepEqual(during.messages, ['extension/background.ts:1:6: ERROR: Expected identifier']);

  server.reload();
  const after = await connect(server.url);
  await settle();
  assert.deepEqual(after.messages, []);
});

test('reloadServer - a web page cannot connect', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  const page = await connect(server.url, 'https://example.com');
  assert.equal(page.opened, false);
});

test('reloadServer - a refused connection that resets does not stop the server', { timeout: 5000 }, async (t) => {
  const server = await startReloadServer(0);
  t.after(() => server.close());
  const { port } = new URL(server.url);
  for (let i = 0; i < 20; i++) {
    const socket = net.connect(Number(port), '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(
      'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
        'Origin: https://example.com\r\n\r\n'
    );
    socket.resetAndDestroy();
  }
  await settle();
  assert.equal((await connect(server.url)).opened, true);
});

test('buildConfig - only a dev build adds the reload code to the extension', () => {
  const config = { rootDir: '/repo', outDir: '/repo/dist', authToken: 'token', serverUrl: 'http://localhost:3000' };
  const bundle = (file: string, reloadUrl?: string) =>
    createBuildOptions({ ...config, reloadUrl }).find(({ outfile }) => outfile?.endsWith(file));

  assert.equal(bundle('background.js')?.inject, undefined);
  assert.equal(bundle('index.js')?.inject, undefined);

  const reloadUrl = 'ws://127.0.0.1:35729/?build=x';
  const serviceWorker = bundle('background.js', reloadUrl);
  assert.deepEqual(serviceWorker?.inject, [path.join('/repo', 'extension/devReload.ts')]);
  assert.equal(serviceWorker?.define?.['process.env.WEBMCP_RELOAD_URL'], JSON.stringify(reloadUrl));
  assert.deepEqual(bundle('index.js', reloadUrl)?.inject, [path.join('/repo', 'extension/sidepanel/devBuildErrors.ts')]);
});
