/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
// When running from dist/tests/smoke.test.js, rootDir is the workspace root.
const projectRoot = fs.existsSync(path.join(rootDir, 'extension/manifest.json'))
  ? rootDir
  : path.resolve(__dirname, '..');

function findChromeBinary(): string {
  for (const envVar of ['CHROME_BIN', 'CHROME_PATH']) {
    const val = process.env[envVar];
    if (val && fs.existsSync(val)) {
      return val;
    }
  }
  const candidates = [
    'chrome',
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    try {
      const resolved = execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
      if (resolved) return resolved;
    } catch {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Could not find a Chrome or Chromium binary to run extension smoke tests.');
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
  sessionId?: string;
}

class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (val: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as CdpMessage;
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(msg.error.message || 'CDP error'));
          } else {
            entry.resolve(msg.result || {});
          }
        }
      }
    });
    const rejectAllPending = (reason: string) => {
      for (const [id, entry] of this.pending.entries()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
        this.pending.delete(id);
      }
    };
    this.ws.addEventListener('close', () => rejectAllPending('CDP WebSocket closed'));
    this.ws.addEventListener('error', () => rejectAllPending('CDP WebSocket error'));
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener(
        'error',
        (err) => reject(new Error(`WebSocket connection failed: ${String(err)}`)),
        { once: true }
      );
    });
    return new CdpClient(ws);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 5000
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async evaluate<T = unknown>(sessionId: string, expression: string): Promise<T> {
    const res = (await this.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    )) as {
      result?: { value?: T; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Runtime.evaluate exception';
      throw new Error(`Evaluation failed: ${desc}`);
    }
    return res.result?.value as T;
  }

  close(): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP client closed'));
      this.pending.delete(id);
    }
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForCondition<T>(
  check: () => Promise<T | null | undefined | false>,
  description: string,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<T> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const suffix = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

async function submitPromptInSidebar(
  cdp: CdpClient,
  sidebarSessionId: string,
  promptText: string
): Promise<void> {
  await cdp.evaluate(
    sidebarSessionId,
    `(() => {
      const input = document.querySelector('input.text-input__field');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(promptText)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  );
  await waitForCondition(async () => {
    return await cdp.evaluate<boolean>(
      sidebarSessionId,
      `Boolean(document.querySelector('button[aria-label="send"]'))`
    );
  }, 'Toolbar button to switch to aria-label="send"');
  await cdp.evaluate(sidebarSessionId, `document.querySelector('button[aria-label="send"]')?.click()`);
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

interface ChatTurnReply {
  chatId?: string;
  text?: string;
  textChunks?: string[];
  functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
}

/**
 * Starts a local HTTP server that:
 * 1. Serves a test web page at `/test-page` with `document.modelContext` exposing
 *    read-only, write, and consequential WebMCP tools.
 * 2. Implements `/api/chat` (NDJSON streaming) and `/api/chat/reset` with
 *    `X-WebMCP-Auth` header validation so the extension side panel can make real
 *    network calls.
 */
async function startSmokeServer(authToken: string): Promise<{
  port: number;
  baseUrl: string;
  chatRequests: Array<Record<string, unknown>>;
  resetRequests: Array<Record<string, unknown>>;
  enqueueReplies: (...replies: ChatTurnReply[]) => void;
  close: () => Promise<void>;
}> {
  const chatRequests: Array<Record<string, unknown>> = [];
  const resetRequests: Array<Record<string, unknown>> = [];
  const replyQueue: ChatTurnReply[] = [];

  const testPageHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>WebMCP Smoke Test Travel Portal</title>
  </head>
  <body>
    <h1>WebMCP Smoke Test Page</h1>
  </body>
</html>`;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WebMCP-Auth');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/test-page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(testPageHtml);
      return;
    }

    if (req.method === 'POST' && (req.url === '/api/chat' || req.url === '/api/chat/reset')) {
      const providedToken = req.headers['x-webmcp-auth'];
      if (providedToken !== authToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid X-WebMCP-Auth' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (req.url === '/api/chat/reset') {
          resetRequests.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        chatRequests.push(body);
        const nextReply = replyQueue.shift() || {
          chatId: (body.chatId as string) || 'smoke-chat-1',
          text: 'Default smoke reply.',
          functionCalls: [],
        };

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        const streamParts = nextReply.textChunks || (nextReply.text ? [nextReply.text] : []);
        for (const chunk of streamParts) {
          res.write(JSON.stringify({ text: chunk }) + '\n');
        }
        const finalText = nextReply.text ?? streamParts.join('');
        res.write(
          JSON.stringify({
            done: true,
            chatId: nextReply.chatId || (body.chatId as string) || 'smoke-chat-1',
            text: finalText,
            functionCalls: (nextReply.functionCalls || []).map((call, idx) => ({
              id: call.id || `call_${Date.now()}_${idx}`,
              name: call.name,
              args: call.args || {},
            })),
          }) + '\n'
        );
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    chatRequests,
    resetRequests,
    enqueueReplies: (...replies: ChatTurnReply[]) => {
      replyQueue.push(...replies);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Builds a complete, isolated unpacked extension into a temporary directory
 * configured against the ephemeral smoke test server.
 */
async function buildStagedExtension(serverUrl: string, authToken: string): Promise<{
  extDir: string;
  originalManifest: Record<string, unknown>;
  cleanup: () => void;
}> {
  const extSourceDir = path.join(projectRoot, 'extension');
  const originalManifest = JSON.parse(
    fs.readFileSync(path.join(extSourceDir, 'manifest.json'), 'utf8')
  ) as Record<string, unknown>;

  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-smoke-ext-'));
  fs.cpSync(extSourceDir, extDir, { recursive: true });

  // Remove minimum_chrome_version in the staged runtime copy so the extension
  // loads on any headless Chrome/Chromium version in CI while originalManifest
  // is still verified directly by our test assertions.
  const stagedManifest = { ...originalManifest };
  delete stagedManifest.minimum_chrome_version;
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(stagedManifest, null, 2));

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'src/index.tsx')],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.woff2': 'file' },
    external: ['node:fs', 'node:path', 'node:os'],
    outfile: path.join(extDir, 'sidebar.js'),
    define: {
      'process.env.WEBMCP_AUTH_TOKEN': JSON.stringify(authToken),
      'process.env.WEBMCP_SERVER_URL': JSON.stringify(serverUrl),
    },
  });

  return {
    extDir,
    originalManifest,
    cleanup: () => {
      fs.rmSync(extDir, { recursive: true, force: true });
    },
  };
}

async function launchChromeWithExtension(extDir: string): Promise<{
  cdp: CdpClient;
  extensionId: string;
  close: () => Promise<void>;
}> {
  const chromeBin = findChromeBinary();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-smoke-profile-'));

  const child: ChildProcess = spawn(
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--dbus-stub',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-features=DialMediaRouteProvider,MediaRouter,OptimizationHints,Translate',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
      '--enable-unsafe-extension-debugging',
      '--remote-debugging-port=0',
      'about:blank',
    ],
    {
      env: {
        ...process.env,
        // On GitHub Actions ubuntu-latest, DBUS_SESSION_BUS_ADDRESS is "disabled:" while
        // the system D-Bus socket (/var/run/dbus/system_bus_socket) is active and causes
        // Chrome's UPower/keyring initialization to block for libdbus's 25s activation timeout.
        // Pointing both variables to /dev/null forces an immediate ECONNREFUSED in <1ms.
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null',
        DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/dev/null',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let cdp: CdpClient | null = null;
  const close = async () => {
    cdp?.close();
    child.stdout?.destroy();
    child.stderr?.destroy();
    try {
      child.kill('SIGKILL');
    } catch {}
    child.unref();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 300);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  };

  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let stderrLog = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(portFilePoller);
        fn();
      };

      const timeout = setTimeout(() => {
        finish(() =>
          reject(
            new Error(`Timed out waiting for Chrome DevTools WebSocket URL. Stderr:\n${stderrLog}`)
          )
        );
      }, 30000);

      // Poll DevToolsActivePort in userDataDir alongside stderr in case stderr is buffered in CI
      const portFile = path.join(userDataDir, 'DevToolsActivePort');
      const portFilePoller = setInterval(() => {
        try {
          if (fs.existsSync(portFile)) {
            const lines = fs
              .readFileSync(portFile, 'utf8')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            if (lines.length >= 2 && /^\d+$/.test(lines[0])) {
              finish(() => resolve(`ws://127.0.0.1:${lines[0]}${lines[1]}`));
            }
          }
        } catch {}
      }, 100);

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrLog += chunk.toString('utf8');
        const match = stderrLog.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          finish(() => resolve(match[1]));
        }
      });

      child.on('exit', (code) => {
        finish(() =>
          reject(new Error(`Chrome exited prematurely with code ${code}. Stderr:\n${stderrLog}`))
        );
      });
    });

    const activeCdp = await CdpClient.connect(wsUrl);
    cdp = activeCdp;

    // Load the unpacked extension once via CDP Extensions.loadUnpacked (avoiding any
    // double-load race with --load-extension that can reload and invalidate content.js).
    const loaded = (await activeCdp.send('Extensions.loadUnpacked', { path: extDir })) as {
      id?: string;
    };
    assert.ok(loaded.id, 'Extensions.loadUnpacked should return an extension ID');
    const extensionId = loaded.id;

    // Wait for the extension service worker (background.js) target to be registered
    // before opening web pages so content_scripts are guaranteed to be ready.
    await waitForCondition(async () => {
      const { targetInfos } = (await activeCdp.send('Target.getTargets')) as {
        targetInfos: TargetInfo[];
      };
      return targetInfos.some(
        (t) => t.url === `chrome-extension://${extensionId}/background.js`
      );
    }, 'Extension background.js service worker target to start');

    return { cdp: activeCdp, extensionId, close };
  } catch (err) {
    await close();
    throw err;
  }
}

test('Extension E2E Smoke Suite: loads MV3 bundle, renders consent & tools popovers, executes WebMCP tool calls, handles permissions, and scrolls', async () => {
  const authToken = `smoke-test-${randomUUID()}`;
  const server = await startSmokeServer(authToken);
  let staged: Awaited<ReturnType<typeof buildStagedExtension>> | null = null;
  let browser: Awaited<ReturnType<typeof launchChromeWithExtension>> | null = null;

  try {
    const activeStaged = await buildStagedExtension(server.baseUrl, authToken);
    staged = activeStaged;
    const activeBrowser = await launchChromeWithExtension(activeStaged.extDir);
    browser = activeBrowser;
    const { cdp, extensionId } = activeBrowser;

    // =========================================================================
    // 1. STATIC & RUNTIME EXTENSION LOADING ("Does it load?")
    // =========================================================================
    assert.equal(activeStaged.originalManifest.manifest_version, 3);
    assert.equal(activeStaged.originalManifest.minimum_chrome_version, '150.0.7861.0');
    for (const requiredAsset of [
      'manifest.json',
      'background.js',
      'content.js',
      'utils.js',
      'sidebar.html',
      'sidebar.js',
      'sidebar.css',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png',
    ]) {
      assert.ok(
        fs.existsSync(path.join(activeStaged.extDir, requiredAsset)),
        `Expected bundled extension asset ${requiredAsset} to exist`
      );
    }

    await cdp.send('Target.setDiscoverTargets', { discover: true });

    // Open the target web page that exposes 10 WebMCP tools via document.modelContext
    const pageUrl = `${server.baseUrl}/test-page`;
    const { targetId: pageTargetId } = (await cdp.send('Target.createTarget', {
      url: pageUrl,
    })) as { targetId: string };
    const { sessionId: pageSessionId } = (await cdp.send('Target.attachToTarget', {
      targetId: pageTargetId,
      flatten: true,
    })) as { sessionId: string };

    // Wait for /test-page navigation to finish before injecting content script world fixtures
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        pageSessionId,
        `location.href.endsWith('/test-page') && document.readyState === 'complete'`
      );
    }, 'Target test page to finish loading');

    // Open the extension side panel UI (sidebar.html)
    const sidebarUrl = `chrome-extension://${extensionId}/sidebar.html`;
    const { targetId: sidebarTargetId } = (await cdp.send('Target.createTarget', {
      url: sidebarUrl,
    })) as { targetId: string };
    const { sessionId: sidebarSessionId } = (await cdp.send('Target.attachToTarget', {
      targetId: sidebarTargetId,
      flatten: true,
    })) as { sessionId: string };

    const sidebarRuntimeId = await waitForCondition(async () => {
      const id = await cdp.evaluate<string>(
        sidebarSessionId,
        'typeof chrome !== "undefined" && chrome.runtime && document.readyState === "complete" ? chrome.runtime.id : ""'
      );
      return id || null;
    }, 'sidebar.html to finish loading with chrome.runtime.id');
    assert.equal(sidebarRuntimeId, extensionId);

    // Set realistic Side Panel viewport dimensions (360x520) so CSS flex & scroll overflow work accurately
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: 360,
        height: 520,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sidebarSessionId
    );

    // Keep the test web page as the active tab in the window so chrome.tabs.query({ active: true, currentWindow: true })
    // inside the sidebar resolves to the test page tab.
    await cdp.send('Target.activateTarget', { targetId: pageTargetId });

    // Wait for React to mount ConsentScreen on first boot
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(document.querySelector('.consent-view') && document.body.innerText.includes('Got it'))`
      );
    }, 'ConsentScreen to mount inside sidebar.html');

    // Click "Got it" on ConsentScreen and verify transition to main Chat View
    await cdp.evaluate(
      sidebarSessionId,
      `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Got it');
        btn?.click();
      })()`
    );

    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `localStorage.getItem('agentConsent') === 'true' && Boolean(document.querySelector('#welcomeCard'))`
      );
    }, 'ConsentScreen dismissal to persist agentConsent and render #welcomeCard');

    // Install the WebMCP `document.modelContext` mock into the content script's ISOLATED world
    // on the active test page tab (since JS expando properties on `document` in MAIN world are
    // isolated from content.js's ISOLATED world unless native WebIDL is enabled), then notify LIST_TOOLS.
    await cdp.evaluate(
      sidebarSessionId,
      `new Promise((resolve, reject) => {
        chrome.tabs.query({}, async (tabs) => {
          const tab = tabs.find(t => t.url && t.url.includes('/test-page'));
          if (!tab?.id || !tab.url) return reject(new Error('No test-page tab found in ' + JSON.stringify(tabs)));
          try {
            await chrome.tabs.update(tab.id, { active: true });
            const [{ result: hasContentScript }] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => typeof listTools === 'function',
            });
            if (!hasContentScript) {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['utils.js', 'content.js'],
              });
            }
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                window.__executedTools = [];
                document.documentElement.dataset.executedTools = '[]';
                const toolsList = [
                  {
                    name: 'get_flights',
                    description: 'Search available flights for a route',
                    inputSchema: JSON.stringify({
                      type: 'object',
                      properties: { destination: { type: 'string' } },
                    }),
                    annotations: {
                      readOnlyHint: true,
                      untrustedContentHint: false,
                      consequentialHint: false,
                    },
                    window,
                  },
                  {
                    name: 'book_flight',
                    description: 'Reserve a passenger seat on a flight',
                    inputSchema: JSON.stringify({
                      type: 'object',
                      properties: { flightCode: { type: 'string' } },
                    }),
                    annotations: {
                      readOnlyHint: false,
                      untrustedContentHint: false,
                      consequentialHint: false,
                    },
                    window,
                  },
                  {
                    name: 'delete_account',
                    description: 'Permanently delete loyalty account and points',
                    inputSchema: JSON.stringify({
                      type: 'object',
                      properties: { confirm: { type: 'boolean' } },
                    }),
                    annotations: {
                      readOnlyHint: false,
                      untrustedContentHint: false,
                      consequentialHint: true,
                    },
                    window,
                  },
                  ...Array.from({ length: 7 }, (_, idx) => ({
                    name: 'extra_travel_tool_' + (idx + 1),
                    description: 'Travel helper action #' + (idx + 1) + ' for itinerary management',
                    inputSchema: JSON.stringify({ type: 'object', properties: {} }),
                    annotations: { readOnlyHint: true, untrustedContentHint: false },
                    window,
                  })),
                ];

                Object.defineProperty(document, 'modelContext', {
                  configurable: true,
                  writable: true,
                  value: {
                    ontoolchange: null,
                    getTools: async () => toolsList,
                    executeTool: async (tool, inputArgs) => {
                      const parsed = typeof inputArgs === 'string' ? JSON.parse(inputArgs) : inputArgs;
                      window.__executedTools.push({ name: tool?.name, args: parsed });
                      document.documentElement.dataset.executedTools = JSON.stringify(window.__executedTools);
                      if (tool?.name === 'get_flights') {
                        return JSON.stringify({
                          flights: [{ code: 'WM101', destination: parsed?.destination || 'Tokyo', price: '$650' }],
                        });
                      }
                      if (tool?.name === 'book_flight') {
                        return JSON.stringify({
                          status: 'confirmed',
                          confirmationCode: 'CONF-WM101',
                          flightCode: parsed?.flightCode || 'WM101',
                        });
                      }
                      if (tool?.name === 'delete_account') {
                        return JSON.stringify({ deleted: true });
                      }
                      return JSON.stringify({ ok: true });
                    },
                    addEventListener: () => {},
                  },
                });
              },
            });
            await chrome.tabs.sendMessage(tab.id, {
              action: 'LIST_TOOLS',
              fromOrigins: [new URL(tab.url).origin],
            }, { frameId: 0 });
            resolve(true);
          } catch (err) {
            reject(err);
          }
        });
      })`
    );

    // Wait for the active tab's 10 WebMCP tools from /test-page to be discovered and displayed on AttachedTab
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(
          document.querySelector('.attached-tab') &&
          document.querySelector('.actions-chip')?.textContent?.includes('10 tools')
        )`
      );
    }, 'AttachedTab to display 127.0.0.1 and "10 tools" badge');

    // Verify background.js also updated the extension action badge to "10"
    const badgeText = await waitForCondition(async () => {
      const text = await cdp.evaluate<string>(
        sidebarSessionId,
        `new Promise(resolve => {
          chrome.tabs.query({}, (tabs) => {
            const tab = tabs.find(t => t.url && t.url.includes('/test-page'));
            if (!tab?.id) return resolve('');
            chrome.action.getBadgeText({ tabId: tab.id }, resolve);
          });
        })`
      );
      return text === '10' ? text : null;
    }, 'background.js to set chrome.action badge text to "10"');
    assert.equal(badgeText, '10');

    // =========================================================================
    // 2. TOOLS BADGE POPUP & SCROLLABLE TOOLS DIALOGUE
    // =========================================================================
    // Click the "10 tools" ActionsChip -> IPHPopover should appear in .floating-popover
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('.actions-chip')?.click()`
    );

    const iphPopoverCheck = await waitForCondition(async () => {
      return await cdp.evaluate<{
        visible: boolean;
        aboveComposer: boolean;
        text: string;
      } | null>(
        sidebarSessionId,
        `(() => {
          const popover = document.querySelector('.floating-popover .iph__card');
          const footer = document.querySelector('.composer-footer');
          if (!popover || !footer) return null;
          const popRect = popover.getBoundingClientRect();
          const footRect = footer.getBoundingClientRect();
          return {
            visible: popRect.width > 0 && popRect.height > 0,
            aboveComposer: popRect.bottom <= footRect.top + 20,
            text: popover.textContent || '',
          };
        })()`
      );
    }, 'IPHPopover to appear above composer footer');

    assert.equal(iphPopoverCheck.visible, true);
    assert.equal(iphPopoverCheck.aboveComposer, true);
    assert.ok(iphPopoverCheck.text.includes('Available WebMCP tools'));

    // Click "View actions" inside IPHPopover -> transitions to WebMCPToolsDialogue
    await cdp.evaluate(
      sidebarSessionId,
      `(() => {
        const btn = [...document.querySelectorAll('.iph__card button')].find(
          b => b.textContent?.trim() === 'View actions'
        );
        btn?.click();
      })()`
    );

    // Verify WebMCPToolsDialogue renders all 10 tools and its list container is scrollable
    const toolsDialogueMetrics = await waitForCondition(async () => {
      return await cdp.evaluate<{
        overflowY: string;
        scrollHeight: number;
        clientHeight: number;
        scrolledTop: number;
        itemCount: number;
      } | null>(
        sidebarSessionId,
        `(() => {
          const list = document.querySelector('.tools-dialogue__list-row');
          if (!list) return null;
          const style = window.getComputedStyle(list);
          list.scrollTop = 50;
          return {
            overflowY: style.overflowY,
            scrollHeight: list.scrollHeight,
            clientHeight: list.clientHeight,
            scrolledTop: list.scrollTop,
            itemCount: list.querySelectorAll('.tools-dialogue__item').length,
          };
        })()`
      );
    }, 'WebMCPToolsDialogue list to render and scroll');

    assert.equal(toolsDialogueMetrics.itemCount, 10);
    assert.equal(toolsDialogueMetrics.overflowY, 'auto');
    assert.ok(
      toolsDialogueMetrics.scrollHeight > toolsDialogueMetrics.clientHeight,
      'WebMCPToolsDialogue list should overflow when 10 tools are present'
    );
    assert.ok(toolsDialogueMetrics.scrolledTop > 0, 'WebMCPToolsDialogue list should scroll vertically');

    // Close WebMCPToolsDialogue
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('.tools-dialogue__close-btn')?.click()`
    );
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `!document.querySelector('.floating-popover')`
      );
    }, 'WebMCPToolsDialogue popover to close');

    // =========================================================================
    // 3. MAKING A CALL & READ-ONLY WEBMCP TOOL EXECUTION ("Can you make a call?")
    // =========================================================================
    // Enqueue 2 turns on the companion backend server:
    // Turn 1: model calls read-only tool `_0_get_flights`
    // Turn 2: model returns a multi-paragraph response after receiving flight data
    const longParagraphs = Array.from(
      { length: 12 },
      (_, i) =>
        `Paragraph ${i + 1}: Flight WM101 to Tokyo is available for $650 with non-stop service and full WebMCP itinerary support.`
    ).join('\n\n');

    server.enqueueReplies(
      {
        chatId: 'smoke-session-1',
        text: '',
        functionCalls: [{ id: 'call_flights_1', name: '_0_get_flights', args: { destination: 'Tokyo' } }],
      },
      {
        chatId: 'smoke-session-1',
        textChunks: ['Here are the flights I found:\n\n', longParagraphs],
      }
    );

    await submitPromptInSidebar(cdp, sidebarSessionId, 'Find flights to Tokyo');

    // Wait for the read-only tool to execute on the test page and the AI response to render
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(
          document.querySelector('.user-bubble')?.textContent?.includes('Find flights to Tokyo') &&
          document.querySelector('.ai-response')?.textContent?.includes('Flight WM101 to Tokyo is available')
        )`
      );
    }, 'Read-only tool call to complete and render AI markdown response');

    // Verify the tool actually ran inside the target web page's document.modelContext
    const executedOnPage = await cdp.evaluate<Array<{ name: string; args: Record<string, unknown> }>>(
      pageSessionId,
      `JSON.parse(document.documentElement.dataset.executedTools || '[]')`
    );
    assert.equal(executedOnPage.length, 1);
    assert.equal(executedOnPage[0].name, 'get_flights');
    assert.deepEqual(executedOnPage[0].args, { destination: 'Tokyo' });

    // Verify the companion server received both the initial message and the tool response turn
    assert.equal(server.chatRequests.length, 2);
    assert.equal(server.chatRequests[0].message, 'Find flights to Tokyo');
    assert.ok(Array.isArray(server.chatRequests[1].toolResponses));

    // =========================================================================
    // 4. SCROLLING VERIFICATION ("Can you scroll?")
    // =========================================================================
    const scrollMetrics = await waitForCondition(async () => {
      return await cdp.evaluate<{
        overflowY: string;
        scrollHeight: number;
        clientHeight: number;
        scrollIntoViewTop: number;
        scrolledToTop: number;
        scrolledToBottom: number;
      } | null>(
        sidebarSessionId,
        `(() => {
          const container = document.querySelector('.chat-card__messages');
          if (!container || container.scrollHeight <= container.clientHeight) return null;
          const style = window.getComputedStyle(container);
          container.lastElementChild?.scrollIntoView();
          const scrollIntoViewTop = container.scrollTop;
          container.scrollTop = 0;
          const scrolledToTop = container.scrollTop;
          container.scrollTop = container.scrollHeight;
          const scrolledToBottom = container.scrollTop;
          return {
            overflowY: style.overflowY,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
            scrollIntoViewTop,
            scrolledToTop,
            scrolledToBottom,
          };
        })()`
      );
    }, '.chat-card__messages to overflow and support vertical scrolling');

    assert.equal(scrollMetrics.overflowY, 'auto');
    assert.ok(
      scrollMetrics.scrollHeight > scrollMetrics.clientHeight,
      `Expected chat messages scrollHeight (${scrollMetrics.scrollHeight}) > clientHeight (${scrollMetrics.clientHeight})`
    );
    assert.ok(
      scrollMetrics.scrollIntoViewTop > 0,
      'Expected scrollIntoView() on chatStreamEndRef to scroll .chat-card__messages down'
    );
    assert.equal(scrollMetrics.scrolledToTop, 0);
    assert.ok(scrollMetrics.scrolledToBottom > 0);

    // =========================================================================
    // 5. PERMISSION POPUPS ("Are popups for permissions showing correctly?")
    // =========================================================================
    // 5a. Standard Write Tool (`book_flight`) -> shows AllowToolPermissionCard with Allow / Don't allow / Allow for this chat
    server.enqueueReplies(
      {
        chatId: 'smoke-session-1',
        text: '',
        functionCalls: [{ id: 'call_book_1', name: '_0_book_flight', args: { flightCode: 'WM101' } }],
      },
      {
        chatId: 'smoke-session-1',
        text: 'Seat reserved with confirmation CONF-WM101.',
      }
    );

    await submitPromptInSidebar(cdp, sidebarSessionId, 'Book flight WM101');

    const writePermissionPopup = await waitForCondition(async () => {
      return await cdp.evaluate<{
        title: string;
        toolName: string;
        hasAllow: boolean;
        hasDeny: boolean;
        alwaysAllowText: string | null;
        isConsequential: boolean;
        inputHidden: boolean;
        actionLogWaiting: boolean;
      } | null>(
        sidebarSessionId,
        `(() => {
          const card = document.querySelector('.tool-permission-card');
          if (!card) return null;
          return {
            title: card.querySelector('.tool-permission-card__title')?.textContent?.trim() || '',
            toolName: card.querySelector('.tool-permission-card__tool-name')?.textContent?.trim() || '',
            hasAllow: Boolean(card.querySelector('.tool-permission-card__btn--allow')),
            hasDeny: Boolean(card.querySelector('.tool-permission-card__btn--deny')),
            alwaysAllowText: card.querySelector('.tool-permission-card__btn--always')?.textContent?.trim() || null,
            isConsequential: card.classList.contains('tool-permission-card--consequential'),
            inputHidden: !document.querySelector('input.text-input__field'),
            actionLogWaiting: document.body.innerText.includes('Waiting for permission'),
          };
        })()`
      );
    }, 'AllowToolPermissionCard to appear for write tool book_flight');

    assert.equal(writePermissionPopup.title, 'Allow tool actions');
    assert.equal(writePermissionPopup.toolName, 'book_flight');
    assert.equal(writePermissionPopup.hasAllow, true);
    assert.equal(writePermissionPopup.hasDeny, true);
    assert.equal(writePermissionPopup.isConsequential, false);
    assert.equal(writePermissionPopup.inputHidden, true);
    assert.equal(writePermissionPopup.actionLogWaiting, true);
    assert.ok(
      writePermissionPopup.alwaysAllowText?.includes('Allow on 127.0.0.1'),
      `Expected session-grant button to include origin host, got: ${writePermissionPopup.alwaysAllowText}`
    );

    // Click "Allow" and verify the write tool executes on the page and completes the turn
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('.tool-permission-card__btn--allow')?.click()`
    );

    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `!document.querySelector('.tool-permission-card') &&
         Boolean(document.querySelector('input.text-input__field')) &&
         document.body.innerText.includes('Seat reserved with confirmation CONF-WM101.')`
      );
    }, 'AllowToolPermissionCard to close and render booking confirmation');

    const executedAfterAllow = await cdp.evaluate<Array<{ name: string }>>(
      pageSessionId,
      `JSON.parse(document.documentElement.dataset.executedTools || '[]')`
    );
    assert.equal(executedAfterAllow.length, 2);
    assert.equal(executedAfterAllow[1].name, 'book_flight');

    // 5b. Consequential Tool (`delete_account`, consequentialHint: true) ->
    // shows warning card ("This action may be irreversible"), NO session-grant button, and Cancel rejects execution
    server.enqueueReplies(
      {
        chatId: 'smoke-session-1',
        text: '',
        functionCalls: [{ id: 'call_del_1', name: '_0_delete_account', args: { confirm: true } }],
      },
      {
        chatId: 'smoke-session-1',
        text: 'Understood, I cancelled deleting your account.',
      }
    );

    await submitPromptInSidebar(cdp, sidebarSessionId, 'Delete my account');

    const consequentialPopup = await waitForCondition(async () => {
      return await cdp.evaluate<{
        title: string;
        toolName: string;
        isConsequential: boolean;
        warningText: string;
        denyText: string;
        hasAlwaysAllow: boolean;
      } | null>(
        sidebarSessionId,
        `(() => {
          const card = document.querySelector('.tool-permission-card');
          if (!card) return null;
          return {
            title: card.querySelector('.tool-permission-card__title')?.textContent?.trim() || '',
            toolName: card.querySelector('.tool-permission-card__tool-name')?.textContent?.trim() || '',
            isConsequential: card.classList.contains('tool-permission-card--consequential'),
            warningText: card.querySelector('#permission-warning')?.textContent?.trim() || '',
            denyText: card.querySelector('.tool-permission-card__btn--deny')?.textContent?.trim() || '',
            hasAlwaysAllow: Boolean(card.querySelector('.tool-permission-card__btn--always')),
          };
        })()`
      );
    }, 'Consequential AllowToolPermissionCard to appear for delete_account');

    assert.equal(consequentialPopup.title, 'This action may be irreversible');
    assert.equal(consequentialPopup.toolName, 'delete_account');
    assert.equal(consequentialPopup.isConsequential, true);
    assert.equal(consequentialPopup.denyText, 'Cancel');
    assert.equal(consequentialPopup.hasAlwaysAllow, false);
    assert.ok(consequentialPopup.warningText.includes('action may not be possible to reverse'));

    // Click "Cancel" (.tool-permission-card__btn--deny) and verify delete_account was NOT executed on the page
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('.tool-permission-card__btn--deny')?.click()`
    );

    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `!document.querySelector('.tool-permission-card') &&
         document.body.innerText.includes('Understood, I cancelled deleting your account.')`
      );
    }, 'Consequential tool cancellation reply to render');

    const executedAfterCancel = await cdp.evaluate<Array<{ name: string }>>(
      pageSessionId,
      `JSON.parse(document.documentElement.dataset.executedTools || '[]')`
    );
    assert.equal(
      executedAfterCancel.length,
      2,
      'Denied consequential tool delete_account must not execute on the page'
    );

    // =========================================================================
    // 6. ACTION LOG EXPANSION, SETTINGS SCREEN & NEW CHAT RESET
    // =========================================================================
    // Expand the completed ActionLog ("Show thinking") and verify tool step labels render
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('button.action-log__header')?.click()`
    );
    const expandedLogLabels = await waitForCondition(async () => {
      return await cdp.evaluate<string[] | null>(
        sidebarSessionId,
        `(() => {
          const items = [...document.querySelectorAll('.action-log__item-label')].map(el => el.textContent?.trim() || '');
          return items.length > 0 ? items : null;
        })()`
      );
    }, 'ActionLog to expand and display executed tool labels');
    assert.ok(
      expandedLogLabels.includes('Get flights'),
      `Expected expanded ActionLog to include "Get flights", got: ${JSON.stringify(expandedLogLabels)}`
    );

    // Open SettingsScreen via Toolbar gear button, toggle Sensitive action alerts, and close Settings
    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('button[aria-label="Settings"]')?.click()`
    );
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(document.querySelector('button[aria-label="Close settings"]'))`
      );
    }, 'SettingsScreen to open');

    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('.cdds-switch')?.click()`
    );
    const alertsAfterToggle = await cdp.evaluate<string | null>(
      sidebarSessionId,
      `localStorage.getItem('sensitiveActionAlerts')`
    );
    assert.equal(alertsAfterToggle, 'false');

    // Toggle back to true and close settings
    await cdp.evaluate(
      sidebarSessionId,
      `(() => {
        document.querySelector('.cdds-switch')?.click();
        document.querySelector('button[aria-label="Close settings"]')?.click();
      })()`
    );

    // Click "Start new chat" and verify /api/chat/reset is called and #welcomeCard returns
    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(document.querySelector('button[aria-label="Start new chat"]'))`
      );
    }, 'Chat view to be restored after closing settings');

    await cdp.evaluate(
      sidebarSessionId,
      `document.querySelector('button[aria-label="Start new chat"]')?.click()`
    );

    await waitForCondition(async () => {
      return await cdp.evaluate<boolean>(
        sidebarSessionId,
        `Boolean(document.querySelector('#welcomeCard'))`
      );
    }, '#welcomeCard to reappear after starting a new chat');
    assert.ok(server.resetRequests.length >= 1, 'Expected /api/chat/reset to be called on new chat');
    assert.equal(server.resetRequests.at(-1)?.chatId, 'smoke-session-1');
  } finally {
    await browser?.close();
    staged?.cleanup();
    await server.close();
  }
});
