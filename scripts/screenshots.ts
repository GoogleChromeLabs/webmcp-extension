/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const outputFile = path.join(rootDir, 'dist', 'screenshots.js');

async function captureScreenshots(): Promise<void> {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  try {
    await esbuild.build({
      entryPoints: [path.join(rootDir, 'tests/smoke/screenshots.ts')],
      bundle: true,
      platform: 'node',
      packages: 'external',
      format: 'esm',
      outfile: outputFile,
      logLevel: 'warning',
    });

    const result = spawnSync(process.execPath, [outputFile], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(outputFile, { force: true });
  }
}

captureScreenshots().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
