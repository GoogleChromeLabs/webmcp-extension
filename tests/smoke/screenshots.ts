/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Captures the README screenshots in docs/screenshots/.
 *
 * Reuses the smoke test harness: headless Chrome with the built extension, the
 * `/test-page` travel tools, and a scripted model server, so every screenshot
 * is reproducible and needs no API key. Run with `npm run screenshots`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { createSmokeSession, type SmokeSessionContext } from './chromeHarness.js';
import {
  clickOrThrow,
  dismissConsentScreen,
  frame0ToolName,
  submitPromptInSidebar,
  waitForAttachedTabTools,
  waitForSidebarText,
  SELECTORS,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { NAMED_TOOLS } from './smokeServer.js';

const OUT_DIR = path.resolve(process.cwd(), 'docs/screenshots');
const WIDTH = 360;
const HEIGHT = 600;
const CHAT_ID = 'screenshot-chat';

/**
 * Screenshots the side panel page through CDP. Puppeteer's `page.screenshot()`
 * may bring the tab to the front, which would make the side panel follow its
 * own tab instead of the test page.
 */
async function capture(sidebar: Page, name: string): Promise<void> {
  // Let streaming text and CSS transitions settle.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const cdp = await sidebar.createCDPSession();
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`📸 ${path.relative(process.cwd(), file)}`);
  } finally {
    await cdp.detach();
  }
}

async function waitForReply(sidebar: Page, text: string): Promise<void> {
  await sidebar.waitForFunction(
    (selectors, text) =>
      !document.querySelector(selectors.permissionCard) &&
      Boolean(document.querySelector(selectors.composerInput)) &&
      document.body.innerText.includes(text),
    SIDEBAR_POLLING,
    SELECTORS,
    text
  );
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let session: SmokeSessionContext | null = null;
  try {
    session = await createSmokeSession({ dismissConsent: false });
    const { server, sidebar } = session;
    await sidebar.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

    // 1. First run: the consent screen.
    await sidebar.waitForSelector('.consent-view');
    await capture(sidebar, 'consent');

    // 2. Tools found on the page.
    await dismissConsentScreen(sidebar);
    await waitForAttachedTabTools(sidebar);
    await clickOrThrow(sidebar, '.actions-chip');
    await sidebar.waitForSelector('.floating-popover .iph__card');
    await clickOrThrow(sidebar, '.iph__card button', 'View actions');
    await sidebar.waitForSelector('.tools-dialogue__list-row .tools-dialogue__item-name');
    await sidebar.$eval('.tools-dialogue__list-row', (list) => list.scrollTo({ top: 0, behavior: 'instant' }));
    await capture(sidebar, 'tools');
    await clickOrThrow(sidebar, '.tools-dialogue__close-btn');
    await sidebar.waitForFunction(() => !document.querySelector('.floating-popover'), SIDEBAR_POLLING);

    // 3. A read-only tool runs without asking, and the reply streams in.
    const flightsReply = [
      'I found one flight to **Tokyo**:\n\n',
      '| Flight | Destination | Price |\n|---|---|---|\n| WM101 | Tokyo | $650 |\n\n',
      'Want me to book it?',
    ];
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_flights', name: frame0ToolName(NAMED_TOOLS.getFlights.name), args: { destination: 'Tokyo' } },
        ],
      },
      { chatId: CHAT_ID, textChunks: flightsReply }
    );
    await submitPromptInSidebar(sidebar, 'Find flights to Tokyo');
    await waitForReply(sidebar, 'Want me to book it?');
    await clickOrThrow(sidebar, 'button.action-log__header');
    await sidebar.waitForSelector('.action-log__item-label');
    await capture(sidebar, 'chat');

    // 4. A tool that changes something asks first.
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_book', name: frame0ToolName(NAMED_TOOLS.bookFlight.name), args: { flightCode: 'WM101' } },
        ],
      },
      { chatId: CHAT_ID, text: 'Done! Your seat on WM101 is confirmed (CONF-WM101).' }
    );
    await submitPromptInSidebar(sidebar, 'Yes, book WM101');
    await sidebar.waitForSelector(SELECTORS.permissionCard);
    await capture(sidebar, 'permission');
    await clickOrThrow(sidebar, SELECTORS.permissionAllow);
    await waitForReply(sidebar, 'CONF-WM101).');

    // 5. A consequential tool always asks, with no "allow for this chat".
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_delete', name: frame0ToolName(NAMED_TOOLS.deleteAccount.name), args: { confirm: true } },
        ],
      },
      { chatId: CHAT_ID, text: 'OK, I did not delete your account.' }
    );
    await submitPromptInSidebar(sidebar, 'Delete my loyalty account');
    await sidebar.waitForSelector('.tool-permission-card--consequential');
    await capture(sidebar, 'consequential');
    await clickOrThrow(sidebar, SELECTORS.permissionDeny);
    await waitForReply(sidebar, 'I did not delete');

    // 6. Settings.
    await clickOrThrow(sidebar, SELECTORS.settingsButton);
    await sidebar.waitForSelector(SELECTORS.closeSettingsButton);
    await waitForSidebarText(sidebar, 'Sensitive action alerts');
    await capture(sidebar, 'settings');
  } finally {
    await session?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
