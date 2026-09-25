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
  frame0ToolName,
  readExecutedTools,
  readPermissionCard,
  submitPromptInSidebar,
  waitForExecutedToolCount,
  waitForSidebarText,
  waitForToolRunOrPrompt,
  SELECTORS,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { type FunctionResponse, NAMED_TOOLS, type SmokeServer } from './smokeServer.js';

const CHAT_ID = 'smoke-perm-1';
const { bookFlight, deleteAccount } = NAMED_TOOLS;

/** Queues a turn where the model calls `book_flight`, followed by its closing reply. */
function enqueueBooking(server: SmokeServer, callId: string, flightCode: string, reply: string): void {
  server.enqueueReplies(
    {
      chatId: CHAT_ID,
      text: '',
      functionCalls: [{ id: callId, name: frame0ToolName(bookFlight.name), args: { flightCode } }],
    },
    { chatId: CHAT_ID, text: reply }
  );
}

/** The single tool response carried by the most recent `/api/chat` request. */
function lastFunctionResponse(server: SmokeServer): FunctionResponse {
  const last = server.chatRequests.at(-1);
  const responses = last?.toolResponses ?? [];
  assert.equal(responses.length, 1, 'Expected the last chat turn to carry exactly one tool response');
  return responses[0].functionResponse;
}

/** Waits until the permission card is gone and the model's closing reply has rendered. */
async function waitForTurnToFinish(session: SmokeSessionContext, reply: string): Promise<void> {
  const { sidebar } = session;
  await sidebar.waitForFunction(
    (selectors, reply) =>
      !document.querySelector(selectors.permissionCard) &&
      Boolean(document.querySelector(selectors.composerInput)) &&
      document.body.innerText.includes(reply),
    SIDEBAR_POLLING,
    SELECTORS,
    reply
  );
}

/**
 * The steps below run in order in one browser session and one chat: the
 * second relies on the first having allowed book_flight only once, and the
 * third on the session grant from the second. `createSequentialSteps` skips
 * the rest once a step fails.
 */
describe('Smoke — Tool Permission Prompts', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
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

  step('asks before running a write tool, and "Allow" runs it once', async () => {
    const { server, page, sidebar } = session;
    const reply = 'Seat reserved with confirmation CONF-WM101.';
    enqueueBooking(server, 'call_book_1', 'WM101', reply);

    await submitPromptInSidebar(sidebar, 'Book flight WM101');
    const card = await readPermissionCard(sidebar);

    assert.equal(card.title, 'Allow tool actions');
    assert.equal(card.toolName, bookFlight.name);
    assert.equal(card.hasAllow, true, `Permission card has no ${SELECTORS.permissionAllow} button`);
    assert.equal(card.hasDeny, true, `Permission card has no ${SELECTORS.permissionDeny} button`);
    assert.equal(card.isConsequential, false);
    assert.equal(card.inputHidden, true);
    assert.equal(card.actionLogWaiting, true);
    assert.ok(
      card.alwaysAllowText?.includes('Allow on 127.0.0.1'),
      `Expected session-grant button to name the page host, got: ${card.alwaysAllowText}`
    );
    // Nothing may run while the user is still being asked.
    assert.equal((await readExecutedTools(page)).length, 0);

    await clickOrThrow(sidebar, SELECTORS.permissionAllow);
    await waitForTurnToFinish(session, reply);

    const executed = await waitForExecutedToolCount(page, 1);
    assert.deepEqual(executed[0], { name: bookFlight.name, args: { flightCode: 'WM101' } });

    const response = lastFunctionResponse(server);
    assert.equal(response.id, 'call_book_1');
    assert.equal(response.name, frame0ToolName(bookFlight.name));
    assert.equal(response.response.error, undefined);
    assert.ok(
      JSON.stringify(response.response.result).includes('CONF-WM101'),
      `Expected the booking result to reach the model, got: ${JSON.stringify(response.response.result)}`
    );
  });

  step('asks again after a one-off "Allow", and stops asking once allowed for the chat', async () => {
    const { server, page, sidebar } = session;

    // A plain "Allow" is not remembered, so the same tool prompts again.
    const grantReply = 'Seat reserved with confirmation CONF-WM102.';
    enqueueBooking(server, 'call_book_2', 'WM102', grantReply);
    await submitPromptInSidebar(sidebar, 'Book flight WM102');
    const card = await readPermissionCard(sidebar);
    assert.equal(card.toolName, bookFlight.name);
    assert.notEqual(card.alwaysAllowText, null, `Permission card has no ${SELECTORS.permissionAlwaysAllow} button`);

    await clickOrThrow(sidebar, SELECTORS.permissionAlwaysAllow);
    await waitForTurnToFinish(session, grantReply);
    await waitForExecutedToolCount(page, 2);

    // With the session grant in place the next call runs straight away. Had the
    // card been shown, the tool would wait for a click and never execute here.
    const grantedReply = 'Seat reserved with confirmation CONF-WM103.';
    enqueueBooking(server, 'call_book_3', 'WM103', grantedReply);
    await submitPromptInSidebar(sidebar, 'Book flight WM103');

    const outcome = await waitForToolRunOrPrompt(page, sidebar, 3);
    assert.equal(outcome, 'executed', 'With a session grant, book_flight must run without a permission card');
    const executed = await readExecutedTools(page);
    assert.equal(executed.length, 3);
    assert.deepEqual(executed[2], { name: bookFlight.name, args: { flightCode: 'WM103' } });
    await waitForSidebarText(sidebar, grantedReply);

    const response = lastFunctionResponse(server);
    assert.equal(response.id, 'call_book_3');
    assert.ok(JSON.stringify(response.response.result).includes('CONF-WM103'));
  });

  step('always confirms a consequential tool, and reports a cancel to the model without running it', async () => {
    const { server, page, sidebar } = session;
    const executedBefore = (await readExecutedTools(page)).length;
    const reply = 'Understood, I cancelled deleting your account.';

    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: 'call_del_1', name: frame0ToolName(deleteAccount.name), args: { confirm: true } },
        ],
      },
      { chatId: CHAT_ID, text: reply }
    );

    await submitPromptInSidebar(sidebar, 'Delete my account');
    const card = await readPermissionCard(sidebar);

    assert.equal(card.title, 'This action may be irreversible');
    assert.equal(card.toolName, deleteAccount.name);
    assert.equal(card.isConsequential, true);
    assert.equal(card.hasAllow, true, `Permission card has no ${SELECTORS.permissionAllow} button`);
    assert.equal(card.denyText, 'Cancel');
    // Even with a session grant already held on this origin, a consequential
    // tool is never offered "don't ask again".
    assert.equal(card.alwaysAllowText, null, 'A consequential tool must never offer a session grant');
    assert.ok(card.warningText.includes('action may not be possible to reverse'));

    await clickOrThrow(sidebar, SELECTORS.permissionDeny);
    await waitForTurnToFinish(session, reply);

    assert.equal(
      (await readExecutedTools(page)).length,
      executedBefore,
      'Denied consequential tool delete_account must not execute on the page'
    );

    const response = lastFunctionResponse(server);
    assert.equal(response.id, 'call_del_1');
    assert.equal(response.name, frame0ToolName(deleteAccount.name));
    assert.equal(response.response.result, undefined, 'A denied tool must not report a result');
    assert.match(response.response.error ?? '', /denied/i);
  });
});
