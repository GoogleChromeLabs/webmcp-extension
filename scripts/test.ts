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
const testsDir = path.join(rootDir, 'tests');
const outputDir = path.join(rootDir, 'dist', 'tests');
const suite = process.argv[2] ?? 'all';
const directoriesBySuite: Record<string, string[]> = {
  all: ['extension', 'server', 'smoke'],
  unit: ['extension', 'server'],
  smoke: ['smoke'],
};
const directories = directoriesBySuite[suite];

if (!directories) {
  throw new Error(`Unknown test suite "${suite}". Use "unit" or "smoke".`);
}

const sourceFiles = directories.flatMap((directory) =>
  fs.readdirSync(path.join(testsDir, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && (
      directory === 'smoke' ? entry.name.endsWith('.smoke.test.ts') : entry.name.endsWith('.test.ts')
    ))
    .map((entry) => path.join(testsDir, directory, entry.name))
).sort();

async function runTests(): Promise<void> {
  fs.rmSync(outputDir, { recursive: true, force: true });

  try {
    await esbuild.build({
      entryPoints: sourceFiles,
      bundle: true,
      platform: 'node',
      packages: 'external',
      format: 'esm',
      jsx: 'automatic',
      outbase: testsDir,
      outdir: outputDir,
    });

    const compiledFiles = sourceFiles.map((sourceFile) =>
      path.join(outputDir, path.relative(testsDir, sourceFile).replace(/\.ts$/, '.js'))
    );
    const result = spawnSync(process.execPath, ['--test', ...compiledFiles], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

runTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
