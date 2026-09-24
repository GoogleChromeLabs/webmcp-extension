/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

/**
 * The esbuild options for the side panel bundle (`sidebar.js` and the
 * `sidebar.css` emitted next to it).
 *
 * Shared by `scripts/build.js` and the Chrome smoke test harness, so the
 * extension the smoke tests load is built exactly the way a release is.
 *
 * @param {object} options
 * @param {string} options.rootDir Project root holding `src/index.tsx`.
 * @param {string} options.outDir Directory the bundle is written into.
 * @param {string} options.authToken Value injected as `process.env.WEBMCP_AUTH_TOKEN`.
 * @param {string} options.serverUrl Value injected as `process.env.WEBMCP_SERVER_URL`.
 * @returns {import('esbuild').BuildOptions}
 */
export function createSidebarBuildOptions({ rootDir, outDir, authToken, serverUrl }) {
  return {
    entryPoints: [path.join(rootDir, 'src/index.tsx')],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.woff2': 'file' },
    outfile: path.join(outDir, 'sidebar.js'),
    define: {
      'process.env.WEBMCP_AUTH_TOKEN': JSON.stringify(authToken),
      'process.env.WEBMCP_SERVER_URL': JSON.stringify(serverUrl),
    },
  };
}
