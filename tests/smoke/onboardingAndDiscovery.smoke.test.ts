/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, waitForCondition } from './wait.js';
import { createSmokeSession, smokeSkipReason, SmokeSessionContext } from './chromeHarness.js';
import { createSequentialSteps } from './sequentialSteps.js';
import {
  clickOrThrow,
  dismissConsentScreen,
  waitForAttachedTabTools,
  TEST_PAGE_TAB_ID_EXPR,
} from './sidebarHelpers.js';
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
    // sidebar.css is emitted by the shared esbuild config from src/styles.css;
    // it has to be linked by sidebar.html and actually carry rules.
    // Resolves only once sidebar.css is attached and has rules; times out otherwise.
    await waitForCondition(
      () =>
        evaluate<number | null>(sidebar, `(() => {
            const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('/sidebar.css'));
            return sheet && sheet.cssRules.length > 0 ? sheet.cssRules.length : null;
          })()`
        ),
      'sidebar.css to be loaded with CSS rules'
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
    await waitForCondition(async () => {
      const text = await evaluate<string>(sidebar, `(async () => {
          const tabId = ${TEST_PAGE_TAB_ID_EXPR};
          return tabId ? await chrome.action.getBadgeText({ tabId }) : '';
        })()`
      );
      return text === expectedBadge ? text : null;
    }, `background.js to set chrome.action badge text to "${expectedBadge}"`);
  });

  step('opens the IPHPopover above the composer from the tools chip', async () => {
    const { sidebar } = session;
    await clickOrThrow(sidebar, '.actions-chip');

    const popover = await waitForCondition(
      () =>
        evaluate<{ visible: boolean; aboveComposer: boolean; text: string } | null>(sidebar, `(() => {
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
        ),
      'IPHPopover to appear above composer footer'
    );

    assert.equal(popover.visible, true);
    assert.equal(popover.aboveComposer, true);
    assert.ok(popover.text.includes('Available WebMCP tools'));
  });

  step('lists every registered tool in a scrollable WebMCPToolsDialogue, and closes it', async () => {
    const { sidebar } = session;
    await clickOrThrow(sidebar, '.iph__card button', 'View actions');

    const dialogue = await waitForCondition(
      () =>
        evaluate<{
          overflowY: string;
          scrollHeight: number;
          clientHeight: number;
          names: string[];
        } | null>(sidebar, `(() => {
            const list = document.querySelector('.tools-dialogue__list-row');
            if (!list) return null;
            const names = [...list.querySelectorAll('.tools-dialogue__item-name')].map((el) => el.textContent || '');
            if (names.length === 0) return null;
            return {
              overflowY: window.getComputedStyle(list).overflowY,
              scrollHeight: list.scrollHeight,
              clientHeight: list.clientHeight,
              names,
            };
          })()`
        ),
      'WebMCPToolsDialogue list to render tool names'
    );

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
    await waitForCondition(
      () => evaluate<boolean>(sidebar, `!document.querySelector('.floating-popover')`),
      'WebMCPToolsDialogue popover to close'
    );
  });
});
