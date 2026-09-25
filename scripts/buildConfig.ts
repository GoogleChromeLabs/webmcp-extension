/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BuildOptions } from 'esbuild';

/**
 * How the extension is built. Shared by `scripts/build.ts` and the Chrome
 * smoke test harness, so the extension the smoke tests load is built exactly
 * the way a release is.
 *
 * Output layout (`outDir`):
 *
 *   manifest.json, icons/     copied from extension/
 *   background.js             service worker (ES module)
 *   content.js                content script (classic script)
 *   sidepanel/index.html      copied from extension/sidepanel/
 *   sidepanel/index.js, .css  side panel bundle
 */

export interface ContentScriptBuildConfig {
  /** Project root. */
  rootDir: string;
  /** Directory the bundle is written into. */
  outDir: string;
}

export interface ExtensionBuildConfig extends ContentScriptBuildConfig {
  /** Value injected as `process.env.WEBMCP_AUTH_TOKEN`. */
  authToken: string;
  /** Value injected as `process.env.WEBMCP_SERVER_URL`. */
  serverUrl: string;
}

/**
 * The esbuild options for the content script. Content scripts cannot be ES
 * modules, so it is bundled as a classic script (IIFE).
 */
export function createContentScriptBuildOptions({ rootDir, outDir }: ContentScriptBuildConfig): BuildOptions {
  return {
    entryPoints: [path.join(rootDir, 'extension/content.ts')],
    bundle: true,
    format: 'iife',
    outfile: path.join(outDir, 'content.js'),
  };
}

/**
 * The esbuild options for every bundle of the extension.
 */
export function createBuildOptions({ rootDir, outDir, authToken, serverUrl }: ExtensionBuildConfig): BuildOptions[] {
  return [
    {
      entryPoints: [path.join(rootDir, 'extension/sidepanel/index.tsx')],
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
      entryPoints: [path.join(rootDir, 'extension/background.ts')],
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
 */
export function staticFiles(rootDir: string, outDir: string): Array<[string, string]> {
  const extensionDir = path.join(rootDir, 'extension');
  return [
    [path.join(extensionDir, 'manifest.json'), path.join(outDir, 'manifest.json')],
    [path.join(extensionDir, 'icons'), path.join(outDir, 'icons')],
    [path.join(extensionDir, 'sidepanel/index.html'), path.join(outDir, 'sidepanel/index.html')],
  ];
}

/**
 * Copies the files esbuild does not produce into `outDir`.
 */
export function copyStaticFiles(rootDir: string, outDir: string): void {
  for (const [source, destination] of staticFiles(rootDir, outDir)) {
    fs.cpSync(source, destination, { recursive: true });
  }
}
