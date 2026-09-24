/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { loadDotEnv, getEnv, ensureAuthToken } from '../server/security.js';
import { copyStaticFiles, createBuildOptions, staticFiles } from './buildConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

const env = loadDotEnv(envPath);
const authToken = ensureAuthToken(env, envPath);
const port = getEnv(env, 'PORT') || '3000';
const serverUrl = `http://localhost:${port}`;

const isWatch = process.argv.includes('--watch');

const distDir = path.join(rootDir, 'dist');
if (!isWatch) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

copyStaticFiles(rootDir, distDir);

const buildOptions = createBuildOptions({
  rootDir,
  outDir: distDir,
  authToken,
  serverUrl,
});

if (isWatch) {
  for (const options of buildOptions) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
  // esbuild only watches what it bundles, so the static files (manifest,
  // icons, the side panel page) are copied again when they change.
  for (const [source] of staticFiles(rootDir, distDir)) {
    fs.watch(source, { recursive: true }, () => copyStaticFiles(rootDir, distDir));
  }
  console.log('👀 Watching for changes with WebMCP auth token injected...');
} else {
  await Promise.all(buildOptions.map((options) => esbuild.build(options)));
  console.log('⚡ Build complete with WebMCP auth token injected.');
}
