/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_ROUND_LIMITS } from '../../extension/sidepanel/services/toolRoundLimits.js';
import { createSmokeSession, smokeSkipReason, type SmokeSessionContext } from './chromeHarness.js';
import { createSequentialSteps } from './sequentialSteps.js';
import {
  clickOrThrow,
  frame0ToolName,
  readExecutedTools,
  readPermissionCard,
  submitPromptInSidebar,
  waitForExecutedToolCount,
  waitForSidebarText,
  SELECTORS,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { type ChatTurnReply, NAMED_TOOLS } from './smokeServer.js';

const CHAT_ID = 'smoke-limit-1';
const { askAfter } = DEFAULT_TOOL_ROUND_LIMITS;

/**
 * `count` replies in which the model asks for flights again, each time to a
 * new city. `get_flights` is read-only, so no permission prompt gets in the way.
 */
function askForFlights(firstRound: number, count: number): ChatTurnReply[] {
  return Array.from({ length: count }, (_, i) => ({
    chatId: CHAT_ID,
    text: '',
    functionCalls: [
      {
        id: `call_${firstRound + i}`,
        name: frame0ToolName(NAMED_TOOLS.getFlights.name),
        args: { destination: `City ${firstRound + i}` },
      },
    ],
  }));
}

/** Waits until the question is gone and the composer is back. */
async function waitForComposer(session: SmokeSessionContext): Promise<void> {
  await session.sidebar.waitForFunction(
    (selectors) =>
      !document.querySelector(selectors.permissionCard) && Boolean(document.querySelector(selectors.composerInput)),
    SIDEBAR_POLLING,
    SELECTORS
  );
}

/**
 * The steps run in order in one browser session and one chat. Each one takes
 * the agent through 10 real rounds of tool calls, so they take a few seconds.
 */
describe('Smoke — Tool Call Limit', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  let session: SmokeSessionContext;
  const step = createSequentialSteps({
    afterEachStep: () =>
      assert.equal(session.server.pendingReplyCount(), 0, 'Every queued model reply should have been used'),
  });

  before(async () => {
    session = await createSmokeSession({ dismissConsent: true });
  });

  after(async () => {
    await session?.close();
  });

  step('asks once after 10 rounds of tool calls, and "Continue" lets the agent carry on', async () => {
    const { server, page, sidebar } = session;
    const reply = 'I checked flights to 11 cities.';
    // One round past the question, then the answer.
    server.enqueueReplies(...askForFlights(1, askAfter + 1), { chatId: CHAT_ID, text: reply });

    await submitPromptInSidebar(sidebar, 'Check flights to as many cities as you can');
    const card = await readPermissionCard(sidebar);

    assert.equal(card.title, 'Keep going?');
    assert.equal(card.toolName, `Used tools ${askAfter} times`);
    assert.equal(card.hasAllow, true, `The question has no ${SELECTORS.permissionAllow} button`);
    assert.equal(card.denyText, 'Stop');
    assert.equal(card.alwaysAllowText, null);
    assert.equal(card.inputHidden, true);
    assert.equal(card.actionLogWaiting, true);
    // Nothing past the question runs while the user is being asked.
    assert.equal((await readExecutedTools(page)).length, askAfter);

    await clickOrThrow(sidebar, SELECTORS.permissionAllow);
    await waitForExecutedToolCount(page, askAfter + 1);
    await waitForComposer(session);
    await waitForSidebarText(sidebar, reply);
  });

  step('"Stop" ends the turn there, without running more tools or showing an error', async () => {
    const { server, page, sidebar } = session;
    const executedBefore = (await readExecutedTools(page)).length;
    server.enqueueReplies(...askForFlights(100, askAfter + 1));

    await submitPromptInSidebar(sidebar, 'Check flights to more cities');
    const card = await readPermissionCard(sidebar);
    assert.equal(card.title, 'Keep going?');

    await clickOrThrow(sidebar, SELECTORS.permissionDeny);
    await waitForComposer(session);

    assert.equal((await readExecutedTools(page)).length, executedBefore + askAfter);
    assert.equal(await sidebar.$('.msg.error'), null, 'A stop the user asked for is not an error');
    assert.equal(await sidebar.$$eval('.action-log', (logs) => logs.length), 2);
    assert.equal(await sidebar.$$eval('.ai-response', (replies) => replies.length), 1, 'History needs no empty reply bubble');
    await sidebar.evaluate(() => {
      document.querySelectorAll<HTMLButtonElement>('.action-log__header')[1].click();
    });
    const labels = await sidebar.$$eval('.action-log__item-label', (items) => items.map((item) => item.textContent?.trim()));
    assert.deepEqual(labels, Array(askAfter).fill('Get flights'));
  });
});
