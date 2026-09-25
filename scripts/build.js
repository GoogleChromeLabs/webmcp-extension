/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { loadDotEnv, ensureAuthToken } from '../server/security.js';
import { DEFAULT_LIVE_MODEL, loadProviders } from '../server/providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

const env = loadDotEnv(envPath);
const authToken = ensureAuthToken(env, envPath);
const port = process.env.PORT || env.PORT || '3000';
const serverUrl = `http://localhost:${port}`;
const providerConfig = loadProviders(env);
const geminiApiKey =
  process.env.GEMINI_API_KEY ||
  env.GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.API_KEY ||
  env.API_KEY ||
  '';
const liveModelId = process.env.LIVE_MODEL || env.LIVE_MODEL || DEFAULT_LIVE_MODEL;
const textModelId =
  providerConfig.spec?.providerId === 'google' ? providerConfig.spec.modelId : 'gemini-3.6-flash';
const googleBaseUrl =
  process.env.GOOGLE_GENERATIVE_AI_BASE_URL ||
  env.GOOGLE_GENERATIVE_AI_BASE_URL ||
  '';

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
    'process.env.WEBMCP_GEMINI_API_KEY': JSON.stringify(geminiApiKey),
    'process.env.WEBMCP_LIVE_MODEL': JSON.stringify(liveModelId),
    'process.env.WEBMCP_TEXT_MODEL': JSON.stringify(textModelId),
    'process.env.WEBMCP_GOOGLE_BASE_URL': JSON.stringify(googleBaseUrl),
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
