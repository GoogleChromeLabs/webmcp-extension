/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSmokeSession, smokeSkipReason, type SmokeSessionContext } from './chromeHarness.js';
import { createSequentialSteps } from './sequentialSteps.js';
import {
  clickOrThrow,
  closeSettings,
  frame0ToolName,
  openSettings,
  readExecutedTools,
  readPermissionCard,
  submitPromptInSidebar,
  waitForSensitiveAlertsSwitch,
  waitForSidebarText,
  waitForToolRunOrPrompt,
  SELECTORS,
} from './sidePanelHelpers.js';
import { NAMED_TOOLS } from './smokeServer.js';

const CHAT_ID = 'smoke-reset-1';
const { bookFlight, deleteAccount } = NAMED_TOOLS;

/**
 * The steps below run in order in one browser session and one chat: each
 * starts from the settings and page state the previous step left behind.
 * `createSequentialSteps` skips the rest once a step fails.
 */
describe('Smoke — Settings & New Chat Reset', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  let session: SmokeSessionContext;
  const step = createSequentialSteps({
    afterEachStep: () =>
      assert.equal(session.server.pendingReplyCount(), 0, 'Every queued model reply should have been used'),
  });

  before(async () => {
    session = await createSmokeSession({ dismissConsent: true });
    const { server, sidebar } = session;

    // Establish an active chat so there is a backend session to reset later.
    const greeting = 'Ready to help with your travel plans.';
    server.enqueueReplies({ chatId: CHAT_ID, text: greeting });
    await submitPromptInSidebar(sidebar, 'Hello travel assistant');
    await waitForSidebarText(sidebar, greeting);
  });

  after(async () => {
    await session?.close();
  });

  step('turning Sensitive action alerts off persists it and lets write tools run without a prompt', async () => {
    const { server, page, sidebar } = session;

    await openSettings(sidebar);
    // Fresh profile: nothing stored yet, and alerts default to on.
    await waitForSensitiveAlertsSwitch(sidebar, { ariaChecked: 'true', stored: null });

    await clickOrThrow(sidebar, SELECTORS.sensitiveAlertsSwitch);
    await waitForSensitiveAlertsSwitch(sidebar, { ariaChecked: 'false', stored: 'false' });
    await closeSettings(sidebar);

    // With alerts off, a write tool runs straight away. Had the card been shown,
    // the tool would wait for a click and never execute here.
    const reply = 'Booked WM201 without asking.';
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_book_off', name: frame0ToolName(bookFlight.name), args: { flightCode: 'WM201' } },
        ],
      },
      { chatId: CHAT_ID, text: reply }
    );
    await submitPromptInSidebar(sidebar, 'Book flight WM201');

    const outcome = await waitForToolRunOrPrompt(page, sidebar, 1);
    assert.equal(outcome, 'executed', 'With alerts off, book_flight must run without a permission card');
    const executed = await readExecutedTools(page);
    assert.deepEqual(executed, [{ name: bookFlight.name, args: { flightCode: 'WM201' } }]);
    await waitForSidebarText(sidebar, reply);
  });

  step('still confirms consequential tools while alerts are off', async () => {
    const { server, page, sidebar } = session;
    const executedBefore = (await readExecutedTools(page)).length;
    const reply = 'Okay, your account stays.';
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_del_off', name: frame0ToolName(deleteAccount.name), args: { confirm: true } },
        ],
      },
      { chatId: CHAT_ID, text: reply }
    );
    await submitPromptInSidebar(sidebar, 'Delete my account');

    const card = await readPermissionCard(sidebar);
    assert.equal(card.isConsequential, true);
    assert.equal(card.toolName, deleteAccount.name);

    await clickOrThrow(sidebar, SELECTORS.permissionDeny);
    await waitForSidebarText(sidebar, reply);
    assert.equal(
      (await readExecutedTools(page)).length,
      executedBefore,
      'Cancelled delete_account must not execute on the page'
    );
  });

  step('turning Sensitive action alerts back on persists it and brings the write-tool prompt back', async () => {
    const { server, page, sidebar } = session;
    const executedBefore = (await readExecutedTools(page)).length;

    await openSettings(sidebar);
    await clickOrThrow(sidebar, SELECTORS.sensitiveAlertsSwitch);
    await waitForSensitiveAlertsSwitch(sidebar, { ariaChecked: 'true', stored: 'true' });
    await closeSettings(sidebar);

    const reply = 'No problem, I did not book WM202.';
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_book_on', name: frame0ToolName(bookFlight.name), args: { flightCode: 'WM202' } },
        ],
      },
      { chatId: CHAT_ID, text: reply }
    );
    await submitPromptInSidebar(sidebar, 'Book flight WM202');

    const card = await readPermissionCard(sidebar);
    assert.equal(card.toolName, bookFlight.name);
    assert.equal(card.isConsequential, false);

    await clickOrThrow(sidebar, SELECTORS.permissionDeny);
    await waitForSidebarText(sidebar, reply);
    assert.equal(
      (await readExecutedTools(page)).length,
      executedBefore,
      'Denied book_flight must not execute on the page'
    );
  });

  step('"Start new chat" resets the backend session exactly once and shows the welcome card', async () => {
    const { server, sidebar } = session;
    assert.equal(server.resetRequests.length, 0);

    await clickOrThrow(sidebar, SELECTORS.newChatButton);
    await sidebar.waitForSelector('#welcomeCard');

    // The reset POST is fire-and-forget, so wait for it rather than reading at once.
    await server.waitForResetRequest();
    // Give a duplicate call time to arrive before asserting there was exactly one.
    // This wait can only hide a very late duplicate; it cannot make the test flaky.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(server.resetRequests.length, 1, 'Expected exactly one /api/chat/reset call');
    assert.equal(server.resetRequests[0].chatId, CHAT_ID);
  });
});
