/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import esbuild from 'esbuild';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { copyStaticFiles, createBuildOptions } from '../../scripts/buildConfig.js';
import { startSmokeServer, SmokeServer, TEST_PAGE_TOOL_COUNT } from './smokeServer.js';
import { dismissConsentScreen, waitForAttachedTabTools } from './sidePanelHelpers.js';

function findProjectRoot(startDir = import.meta.dirname): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, 'public/manifest.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate project root containing public/manifest.json from ${startDir}`
      );
    }
    current = parent;
  }
}

const projectRoot = findProjectRoot();

/** Timeout for every Puppeteer wait in the smoke tests. */
const WAIT_TIMEOUT_MS = 10_000;

/**
 * Finds a Chrome or Chromium binary, or returns null when none is installed.
 * `CHROME_BIN` / `CHROME_PATH` win when they point at an existing file; CI
 * sets `CHROME_BIN` to the Chrome for Testing build from `@puppeteer/browsers`.
 */
function resolveChromeBinary(): string | null {
  for (const envVar of ['CHROME_BIN', 'CHROME_PATH']) {
    const val = process.env[envVar];
    if (val && fs.existsSync(val)) {
      return val;
    }
  }
  // Prefer Chromium / Chrome for Testing before branded Google Chrome builds.
  // Branded Chrome currently loads the unpacked extension too (through the pipe
  // transport and `Browser.installExtension`), but Google may restrict
  // extension loading in branded builds, while Chrome for Testing is made for
  // automation.
  const candidates = [
    'chromium',
    'chromium-browser',
    'chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome-stable',
    'google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const resolved = execFileSync('which', [candidate], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (resolved) return resolved;
    } catch {}
  }
  return null;
}

function findChromeBinary(): string {
  const chromeBin = resolveChromeBinary();
  if (!chromeBin) {
    throw new Error(
      'Could not find a Chrome or Chromium binary to run extension smoke tests. Set CHROME_BIN, ' +
        'for example: CHROME_BIN=$(npx @puppeteer/browsers install chrome@stable --format "{{path}}")'
    );
  }
  return chromeBin;
}

/**
 * Why the smoke suites should be skipped, or `false` to run them.
 *
 * Without a browser the suites are skipped locally, so `npm test` still works
 * on a machine with no Chrome. Under CI (`CI` is set, as on GitHub Actions)
 * they always run, so a missing browser fails the build instead of silently
 * dropping coverage.
 */
export function smokeSkipReason(): string | false {
  const ci = process.env.CI;
  if (ci && ci !== 'false' && ci !== '0') return false;
  return resolveChromeBinary()
    ? false
    : 'No Chrome/Chromium binary found (set CHROME_BIN to run the extension smoke tests)';
}

interface StagedExtension {
  extDir: string;
  cleanup: () => void;
}

/**
 * Builds a complete, isolated unpacked extension into a temporary directory
 * configured against the ephemeral smoke test server. Uses the same esbuild
 * options as `npm run build`, so the smoke tests exercise the release bundle.
 */
async function buildStagedExtension(serverUrl: string, authToken: string): Promise<StagedExtension> {
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-smoke-ext-'));
  copyStaticFiles(projectRoot, extDir);
  await Promise.all(
    createBuildOptions({ rootDir: projectRoot, outDir: extDir, authToken, serverUrl }).map((options) =>
      esbuild.build(options)
    )
  );

  return {
    extDir,
    cleanup: () => {
      fs.rmSync(extDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

/**
 * Launches headless Chrome with WebMCP enabled and installs the unpacked
 * extension, returning once its background service worker is running (so
 * content scripts are ready before any page opens).
 */
async function launchChromeWithExtension(
  extDir: string
): Promise<{ browser: Browser; extensionId: string }> {
  const browser = await puppeteer.launch({
    executablePath: findChromeBinary(),
    headless: true,
    // `Browser.installExtension` needs the pipe transport.
    pipe: true,
    enableExtensions: true,
    // Puppeteer's default args already cover `--disable-dev-shm-usage` and
    // disable Translate, MediaRouter and OptimizationHints; it merges these
    // feature lists with its own.
    args: [
      // GitHub's ubuntu-latest (24.04) blocks unprivileged user namespaces with
      // AppArmor, and Chrome for Testing ships no SUID sandbox helper, so Chrome
      // exits with "No usable sandbox" unless the sandbox is turned off.
      '--no-sandbox',
      '--enable-features=WebMCP',
      '--disable-features=DialMediaRouteProvider',
    ],
    env: {
      ...process.env,
      // On GitHub Actions ubuntu-latest, DBUS_SESSION_BUS_ADDRESS is "disabled:" while
      // the system D-Bus socket is active, and Chrome's UPower/keyring setup blocks for
      // libdbus's 25s activation timeout. Pointing both at /dev/null fails in <1ms.
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
      DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/dev/null',
    },
  });

  try {
    const extensionId = await browser.installExtension(extDir);
    await browser.waitForTarget(
      (target) =>
        target.type() === 'service_worker' &&
        target.url() === `chrome-extension://${extensionId}/background.js`,
      { timeout: 10_000 }
    );
    return { browser, extensionId };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Pages a smoke session can open, with the path of the frame that registers
 * their tools and how many tools that frame registers.
 */
const TEST_PAGES = {
  '/test-page': { toolFramePath: '/test-page', toolCount: TEST_PAGE_TOOL_COUNT },
  '/frame-host': { toolFramePath: '/frame-tool', toolCount: 1 },
} as const;

export type TestPagePath = keyof typeof TEST_PAGES;

export interface SmokeSessionContext {
  server: SmokeServer;
  browser: Browser;
  /** The tab exposing the WebMCP tools (`/test-page` unless another page was asked for). */
  page: Page;
  /** The extension's `sidepanel/index.html`, sized like the side panel. */
  sidebar: Page;
  close: () => Promise<void>;
}

/**
 * Boots a complete end-to-end smoke environment:
 * - Local companion server + `/test-page` registering every tool in TEST_PAGE_TOOLS
 * - Temporary bundled extension + headless Chrome with `--enable-features=WebMCP`
 * - Opens `testPage` (`/test-page` by default) and `sidepanel/index.html` (sized
 *   to 360x520) and makes the test page the active tab, as it is when a user
 *   opens the side panel on it
 * - Optionally dismisses the initial ConsentScreen and waits for every tool to attach
 */
export async function createSmokeSession(options?: {
  dismissConsent?: boolean;
  testPage?: TestPagePath;
}): Promise<SmokeSessionContext> {
  const dismissConsent = options?.dismissConsent ?? true;
  const testPage = options?.testPage ?? '/test-page';
  const { toolFramePath, toolCount } = TEST_PAGES[testPage];
  const authToken = `smoke-test-${randomUUID()}`;
  const server = await startSmokeServer(authToken);
  let staged: StagedExtension | null = null;
  let browser: Browser | null = null;

  const close = async () => {
    try {
      await browser?.close();
    } finally {
      try {
        staged?.cleanup();
      } finally {
        await server.close();
      }
    }
  };

  try {
    staged = await buildStagedExtension(server.baseUrl, authToken);
    const launched = await launchChromeWithExtension(staged.extDir);
    browser = launched.browser;

    // Puppeteer waits default to 30s; fail sooner so a broken step is quick to spot.
    const page = await browser.newPage();
    page.setDefaultTimeout(WAIT_TIMEOUT_MS);
    await page.goto(`${server.baseUrl}${testPage}`);
    const toolFrame = await page.waitForFrame((frame) => new URL(frame.url()).pathname === toolFramePath);
    await toolFrame.waitForFunction(() => window.__toolsRegistered === true);

    const sidebar = await browser.newPage();
    sidebar.setDefaultTimeout(WAIT_TIMEOUT_MS);
    await sidebar.setViewport({ width: 360, height: 520 });
    await sidebar.goto(`chrome-extension://${launched.extensionId}/sidepanel/index.html`);
    const runtimeId = await sidebar.evaluate(() => chrome.runtime.id);
    if (runtimeId !== launched.extensionId) {
      throw new Error(`The side panel runs as ${runtimeId}, expected ${launched.extensionId}`);
    }

    // The side panel follows chrome.tabs.query({ active: true, currentWindow: true }),
    // so make the test page the active tab again after opening the side panel.
    await page.bringToFront();

    if (dismissConsent) {
      await dismissConsentScreen(sidebar);
      await waitForAttachedTabTools(sidebar, toolCount);
    }

    return { server, browser, page, sidebar, close };
  } catch (err) {
    await close();
    throw err;
  }
}
