/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSmokeSession, smokeSkipReason, SmokeSessionContext } from './chromeHarness.js';
import { createSequentialSteps } from './sequentialSteps.js';
import {
  clickOrThrow,
  dismissConsentScreen,
  waitForAttachedTabTools,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { TEST_PAGE_TOOL_COUNT, TEST_PAGE_TOOLS } from './smokeServer.js';

/**
 * The steps below follow a first-run user in order (consent, discovery, popover,
 * dialogue) in one browser session. `createSequentialSteps` skips the rest once
 * a step fails.
 */
describe('Smoke — Onboarding & Tool Discovery', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  let session: SmokeSessionContext;
  const step = createSequentialSteps();

  before(async () => {
    session = await createSmokeSession({ dismissConsent: false });
  });

  after(async () => {
    await session?.close();
  });

  step('loads the bundled sidebar stylesheet into the side panel', async () => {
    const { sidebar } = session;
    // sidepanel/index.css is emitted by the shared esbuild config from
    // src/sidepanel/styles.css; the page has to link it and it has to carry rules.
    await sidebar.waitForFunction(
      () =>
        [...document.styleSheets].some(
          (sheet) => sheet.href?.endsWith('/sidepanel/index.css') && sheet.cssRules.length > 0
        ),
      SIDEBAR_POLLING
    );
  });

  step('shows the ConsentScreen on first boot and persists its dismissal', async () => {
    await dismissConsentScreen(session.sidebar);
  });

  step('discovers every tool on the active tab and mirrors the count on the action badge', async () => {
    const { sidebar } = session;
    await waitForAttachedTabTools(sidebar, TEST_PAGE_TOOL_COUNT);

    const expectedBadge = String(TEST_PAGE_TOOL_COUNT);
    // Resolves only once the badge shows the tool count; times out otherwise.
    await sidebar.waitForFunction(
      async (expected) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url?.includes('/test-page'));
        return tab?.id !== undefined && (await chrome.action.getBadgeText({ tabId: tab.id })) === expected;
      },
      SIDEBAR_POLLING,
      expectedBadge
    );
  });

  step('opens the IPHPopover above the composer from the tools chip', async () => {
    const { sidebar } = session;
    await clickOrThrow(sidebar, '.actions-chip');

    await sidebar.waitForSelector('.floating-popover .iph__card');
    const popover = await sidebar.evaluate(() => {
      const card = document.querySelector('.floating-popover .iph__card');
      const footer = document.querySelector('.composer-footer');
      const popRect = card?.getBoundingClientRect();
      const footRect = footer?.getBoundingClientRect();
      return {
        visible: Boolean(popRect && popRect.width > 0 && popRect.height > 0),
        aboveComposer: Boolean(popRect && footRect && popRect.bottom <= footRect.top + 20),
        text: card?.textContent || '',
      };
    });

    assert.equal(popover.visible, true);
    assert.equal(popover.aboveComposer, true);
    assert.ok(popover.text.includes('Available WebMCP tools'));
  });

  step('lists every registered tool in a scrollable WebMCPToolsDialogue, and closes it', async () => {
    const { sidebar } = session;
    await clickOrThrow(sidebar, '.iph__card button', 'View actions');

    await sidebar.waitForSelector('.tools-dialogue__list-row .tools-dialogue__item-name');
    const dialogue = await sidebar.$eval('.tools-dialogue__list-row', (list) => ({
      overflowY: window.getComputedStyle(list).overflowY,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      names: [...list.querySelectorAll('.tools-dialogue__item-name')].map((el) => el.textContent || ''),
    }));

    // The dialogue lists each tool by the description the page registered, so it
    // must show exactly the page's tools, not just the right number of rows.
    assert.deepEqual(
      dialogue.names.map((label) => label.trim()).sort(),
      TEST_PAGE_TOOLS.map((tool) => tool.description).sort()
    );
    // Overflowing content plus overflow-y: auto is what makes the list scrollable.
    assert.equal(dialogue.overflowY, 'auto');
    assert.ok(
      dialogue.scrollHeight > dialogue.clientHeight,
      `Expected the tools list to overflow (scrollHeight ${dialogue.scrollHeight} > clientHeight ${dialogue.clientHeight})`
    );

    await clickOrThrow(sidebar, '.tools-dialogue__close-btn');
    await sidebar.waitForFunction(() => !document.querySelector('.floating-popover'), SIDEBAR_POLLING);
  });
});
