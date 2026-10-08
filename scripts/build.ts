/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { loadDotEnv, getEnv, ensureAuthToken } from '../server/security.ts';
import { copyStaticFiles, createBuildOptions, staticFiles } from './buildConfig.ts';
import { startReloadServer } from './reloadServer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

const env = loadDotEnv(envPath);
const authToken = ensureAuthToken(env, envPath);
const port = getEnv(env, 'PORT') || '3000';
const serverUrl = `http://localhost:${port}`;
const RELOAD_PORT = 35729;
const { name: extensionName } = JSON.parse(fs.readFileSync(path.join(rootDir, 'extension/manifest.json'), 'utf8'));

const isWatch = process.argv.includes('--watch');

const distDir = path.join(rootDir, 'dist');
if (!isWatch) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

copyStaticFiles(rootDir, distDir);

const reloadServer = isWatch
  ? await startReloadServer(RELOAD_PORT).catch((error: Error) => {
      console.warn(`⚠️  Hot reload is off (${error.message}). Reload ${extensionName} by hand after each rebuild.`);
      return undefined;
    })
  : undefined;

const buildOptions = createBuildOptions({
  rootDir,
  outDir: distDir,
  authToken,
  serverUrl,
  reloadUrl: reloadServer?.url,
});

// The errors of the latest build of each bundle, empty when it succeeded. The
// extension is only reloaded when all of them have built and none has errors.
const bundleErrors = new Map<string, string>();
let reloadTimeout: ReturnType<typeof setTimeout> | undefined;
function afterBuild(): void {
  clearTimeout(reloadTimeout);
  const errors = [...bundleErrors.values()].filter(Boolean).join('\n');
  if (errors) {
    reloadServer?.reportErrors(errors);
  } else if (bundleErrors.size === buildOptions.length) {
    reloadTimeout = setTimeout(() => reloadServer?.reload(), 100);
  }
}

if (isWatch) {
  for (const options of buildOptions) {
    const ctx = await esbuild.context({
      ...options,
      plugins: [
        {
          name: 'reload-extension',
          setup(build) {
            build.onEnd(async ({ errors }) => {
              const formatted = await esbuild.formatMessages(errors, { kind: 'error', color: false });
              bundleErrors.set(String(options.outfile), formatted.join(''));
              afterBuild();
            });
          },
        },
      ],
    });
    await ctx.watch();
  }
  // esbuild only watches what it bundles, so the static files (manifest,
  // icons, the side panel page) are copied again when they change. Folders
  // are watched rather than files, and without `recursive`: editors that save
  // by renaming a temp file over the original replace its inode, and both a
  // watcher on the file and Node 22's recursive watcher on Linux stop firing
  // after that. A plain folder watcher keeps reporting the name.
  // Folder -> file names to react to, or null for anything in the folder.
  const watched = new Map<string, Set<string> | null>();
  for (const [source] of staticFiles(rootDir, distDir)) {
    if (fs.statSync(source).isDirectory()) {
      watched.set(source, null);
      continue;
    }
    const dir = path.dirname(source);
    const names = watched.get(dir);
    if (names === null) continue;
    watched.set(dir, (names ?? new Set<string>()).add(path.basename(source)));
  }
  for (const [dir, names] of watched) {
    fs.watch(dir, (_event, filename) => {
      if (names === null || (filename && names.has(filename))) {
        copyStaticFiles(rootDir, distDir);
        afterBuild();
      }
    });
  }
  console.log('👀 Watching for changes with WebMCP auth token injected...');
  if (reloadServer) console.log(`🔄 Hot reload is on. ${extensionName} reloads in Chrome after every rebuild.`);
} else {
  await Promise.all(buildOptions.map((options) => esbuild.build(options)));
  console.log('⚡ Build complete with WebMCP auth token injected.');
}
