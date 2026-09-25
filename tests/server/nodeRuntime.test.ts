/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

/**
 * The other server tests are bundled by esbuild, which forgives things plain
 * Node does not: an import without its `.ts` extension, or a type imported
 * without `import type`. `npm run server` runs `server/server.ts` straight
 * through Node's type stripping, so this starts it exactly that way and waits
 * until it is listening. Any of those mistakes stops it before that point.
 */
test('server - server/server.ts starts under plain Node type stripping', async () => {
  const serverEntry = path.resolve(process.cwd(), 'server/server.ts');
  const child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // A fixed token keeps the server from writing one into .env, and port 0
      // lets the OS choose a free port so this never clashes with a dev server.
      WEBMCP_AUTH_TOKEN: 'node-runtime-test-token',
      HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Server did not start within 15s.\nstdout:\n${stdout}\nstderr:\n${stderr}`)),
        15_000
      );
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.includes('Backend model server listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`Server exited early (code ${code}, signal ${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      });
    });

    assert.doesNotMatch(stderr, /ERR_|SyntaxError/, `Unexpected errors on stderr:\n${stderr}`);
  } finally {
    child.removeAllListeners('exit');
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
