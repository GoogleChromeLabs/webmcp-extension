/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import esbuild from 'esbuild';
import { createContentScriptBuildOptions } from '../../scripts/buildConfig.ts';

/**
 * The content script exactly as the build ships it: `extension/content.ts` bundled
 * into a classic script with the release esbuild options, so tests can run
 * the real code in a sandbox rather than a copy of it.
 */
export function buildContentScript(): string {
  const rootDir = process.cwd();
  const result = esbuild.buildSync({
    ...createContentScriptBuildOptions({ rootDir, outDir: path.join(rootDir, 'dist') }),
    write: false,
  });
  return result.outputFiles[0].text;
}
