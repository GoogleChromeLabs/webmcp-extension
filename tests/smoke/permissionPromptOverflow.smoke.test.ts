/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import { createSmokeSession, smokeSkipReason, type SmokeSessionContext } from './chromeHarness.js';
import { createSequentialSteps } from './sequentialSteps.js';
import {
  clickOrThrow,
  frame0ToolName,
  readPermissionCard,
  scrollToAsUser,
  submitPromptInSidebar,
  waitForExecutedToolCount,
  SELECTORS,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { LONG_DESCRIPTION_TOOL } from './smokeServer.js';

const CHAT_ID = 'smoke-long-prompt-1';
const CITY = 'Tokyo';

/** Far taller than the whole prompt, so it fits without scrolling. */
const TALL_PANEL_HEIGHT = 2000;

/** Every button on the prompt, top to bottom. */
const PROMPT_BUTTONS = [SELECTORS.permissionDeny, SELECTORS.permissionAllow, SELECTORS.permissionAlwaysAllow];

/** Where the prompt sits in the side panel. */
interface PromptLayout {
  top: number;
  bottom: number;
  viewportHeight: number;
  /** Height of the tool description alone. */
  descriptionHeight: number;
  /** How far the prompt's content runs past the prompt's own box, which is how far it scrolls. */
  overflowHeight: number;
}

async function readPromptLayout(sidebar: Page): Promise<PromptLayout> {
  return sidebar.$eval(SELECTORS.permissionCard, (card) => {
    const { top, bottom } = card.getBoundingClientRect();
    return {
      top,
      bottom,
      viewportHeight: window.innerHeight,
      descriptionHeight: card.querySelector('.tool-permission-card__tool-desc')?.getBoundingClientRect().height ?? 0,
      overflowHeight: card.scrollHeight - card.clientHeight,
    };
  });
}

/**
 * A tool whose description is taller than the side panel. The steps below run
 * in order in one browser session and one chat: each picks up the prompt the
 * step before it left open. `createSequentialSteps` skips the rest once a step
 * fails.
 */
describe('Smoke — Permission Prompt Taller Than the Panel', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  let session: SmokeSessionContext;
  const step = createSequentialSteps({
    afterEachStep: () =>
      assert.equal(session.server.pendingReplyCount(), 0, 'Every queued model reply should have been used'),
  });

  before(async () => {
    session = await createSmokeSession({ dismissConsent: true, testPage: '/long-description' });
  });

  after(async () => {
    await session?.close();
  });

  step('keeps the prompt inside the side panel, with every button in reach', async () => {
    const { server, sidebar } = session;
    server.enqueueReplies({
      chatId: CHAT_ID,
      text: '',
      functionCalls: [{ id: 'call_hotel_1', name: frame0ToolName(LONG_DESCRIPTION_TOOL.name), args: { city: CITY } }],
    });

    await submitPromptInSidebar(sidebar, `Book a hotel in ${CITY}`);
    const card = await readPermissionCard(sidebar);
    assert.equal(card.toolName, LONG_DESCRIPTION_TOOL.name);

    const layout = await readPromptLayout(sidebar);
    // A description that fits would let the prompt pass without ever scrolling.
    assert.ok(
      layout.descriptionHeight > layout.viewportHeight,
      `The description is ${layout.descriptionHeight}px tall, which fits in the ${layout.viewportHeight}px panel`
    );
    assert.ok(
      layout.top >= 0 && layout.bottom <= layout.viewportHeight,
      `The prompt spans ${layout.top}px to ${layout.bottom}px of the ${layout.viewportHeight}px tall panel`
    );

    for (const selector of PROMPT_BUTTONS) {
      const button = await scrollToAsUser(sidebar, selector);
      assert.ok(
        button.inViewport,
        `${selector} is at ${button.top}px to ${button.bottom}px of the ${button.viewportHeight}px tall panel, ` +
          'even after scrolling to it'
      );
      assert.ok(button.clickable, `A click on ${selector} lands on another element`);
    }
  });

  step('shows the whole prompt without scrolling once the panel is tall enough', async () => {
    const { sidebar } = session;
    const panel = sidebar.viewport();
    assert.ok(panel, 'The side panel page has no viewport set');

    await sidebar.setViewport({ ...panel, height: TALL_PANEL_HEIGHT });
    try {
      await sidebar.waitForFunction((height) => window.innerHeight === height, SIDEBAR_POLLING, TALL_PANEL_HEIGHT);
      const layout = await readPromptLayout(sidebar);
      assert.equal(layout.overflowHeight, 0, `The prompt scrolls by ${layout.overflowHeight}px`);
      assert.ok(
        layout.bottom <= layout.viewportHeight,
        `The prompt ends at ${layout.bottom}px of the ${layout.viewportHeight}px tall panel`
      );
    } finally {
      await sidebar.setViewport(panel);
    }
  });

  step('runs the tool once the user allows it', async () => {
    const { server, page, sidebar } = session;
    const reply = `Your hotel in ${CITY} is booked.`;
    server.enqueueReplies({ chatId: CHAT_ID, text: reply });

    await clickOrThrow(sidebar, SELECTORS.permissionAllow);
    await sidebar.waitForFunction(
      (selectors, reply) =>
        !document.querySelector(selectors.permissionCard) && document.body.innerText.includes(reply),
      SIDEBAR_POLLING,
      SELECTORS,
      reply
    );

    const executed = await waitForExecutedToolCount(page, 1);
    assert.deepEqual(executed[0], { name: LONG_DESCRIPTION_TOOL.name, args: { city: CITY } });
  });
});
