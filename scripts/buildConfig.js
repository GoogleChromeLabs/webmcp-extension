/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * How the extension is built. Shared by `scripts/build.js` and the Chrome
 * smoke test harness, so the extension the smoke tests load is built exactly
 * the way a release is.
 *
 * Output layout (`outDir`):
 *
 *   manifest.json, icons/     copied from public/
 *   background.js             service worker (ES module)
 *   content.js                content script (classic script)
 *   sidepanel/index.html      copied from src/sidepanel/
 *   sidepanel/index.js, .css  side panel bundle
 */

/**
 * The esbuild options for the content script. Content scripts cannot be ES
 * modules, so it is bundled as a classic script (IIFE).
 *
 * @param {object} options
 * @param {string} options.rootDir Project root.
 * @param {string} options.outDir Directory the bundle is written into.
 * @returns {import('esbuild').BuildOptions}
 */
export function createContentScriptBuildOptions({ rootDir, outDir }) {
  return {
    entryPoints: [path.join(rootDir, 'src/content.ts')],
    bundle: true,
    format: 'iife',
    outfile: path.join(outDir, 'content.js'),
  };
}

/**
 * The esbuild options for every bundle of the extension.
 *
 * @param {object} options
 * @param {string} options.rootDir Project root.
 * @param {string} options.outDir Directory the extension is written into.
 * @param {string} options.authToken Value injected as `process.env.WEBMCP_AUTH_TOKEN`.
 * @param {string} options.serverUrl Value injected as `process.env.WEBMCP_SERVER_URL`.
 * @returns {import('esbuild').BuildOptions[]}
 */
export function createBuildOptions({ rootDir, outDir, authToken, serverUrl }) {
  return [
    {
      entryPoints: [path.join(rootDir, 'src/sidepanel/index.tsx')],
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      loader: { '.woff2': 'file' },
      outfile: path.join(outDir, 'sidepanel/index.js'),
      define: {
        'process.env.WEBMCP_AUTH_TOKEN': JSON.stringify(authToken),
        'process.env.WEBMCP_SERVER_URL': JSON.stringify(serverUrl),
      },
    },
    {
      entryPoints: [path.join(rootDir, 'src/background.ts')],
      bundle: true,
      format: 'esm',
      outfile: path.join(outDir, 'background.js'),
    },
    createContentScriptBuildOptions({ rootDir, outDir }),
  ];
}

/**
 * The files esbuild does not produce, as `[source, destination]` pairs. They
 * are copied as they are.
 *
 * @param {string} rootDir Project root.
 * @param {string} outDir Directory the extension is written into.
 * @returns {Array<[string, string]>}
 */
export function staticFiles(rootDir, outDir) {
  return [
    [path.join(rootDir, 'public'), outDir],
    [path.join(rootDir, 'src/sidepanel/index.html'), path.join(outDir, 'sidepanel/index.html')],
  ];
}

/**
 * Copies the files esbuild does not produce into `outDir`.
 *
 * @param {string} rootDir Project root.
 * @param {string} outDir Directory the extension is written into.
 */
export function copyStaticFiles(rootDir, outDir) {
  for (const [source, destination] of staticFiles(rootDir, outDir)) {
    fs.cpSync(source, destination, { recursive: true });
  }
}
