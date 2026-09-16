/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { loadDotEnv, ensureAuthToken } from '../server/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

const env = loadDotEnv(envPath);
const authToken = ensureAuthToken(env, envPath);
const port = process.env.PORT || env.PORT || '3000';
const serverUrl = `http://localhost:${port}`;

const isWatch = process.argv.includes('--watch');

const distDir = path.join(rootDir, 'dist');
if (!isWatch) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

function copyStaticAssets() {
  // Only the extension shell is copied verbatim. Everything under src/ is
  // bundled by esbuild below, including the fonts referenced from styles.css,
  // so copying it here would ship the sources and a second copy of the fonts.
  fs.cpSync(path.join(rootDir, 'extension'), distDir, { recursive: true });
}

copyStaticAssets();



const buildOptions = {
  entryPoints: [path.join(rootDir, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  loader: { '.woff2': 'file' },
  external: ['node:fs', 'node:path', 'node:os'],
  outfile: path.join(distDir, 'sidebar.js'),
  define: {
    'process.env.WEBMCP_AUTH_TOKEN': JSON.stringify(authToken),
    'process.env.WEBMCP_SERVER_URL': JSON.stringify(serverUrl),
  },
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('👀 Watching for changes with WebMCP auth token injected...');
} else {
  await esbuild.build(buildOptions);
  console.log('⚡ Build complete with WebMCP auth token injected.');
}
