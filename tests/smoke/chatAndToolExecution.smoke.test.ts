/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import { evaluate, waitForCondition } from './wait.js';
import { createSmokeSession, smokeSkipReason, SmokeSessionContext } from './chromeHarness.js';
import {
  clickOrThrow,
  frame0ToolName,
  readExecutedTools,
  submitPromptInSidebar,
  waitForExecutedToolCount,
} from './sidebarHelpers.js';
import { NAMED_TOOLS } from './smokeServer.js';

const CHAT_ID = 'smoke-session-1';
const PROMPT = 'Find flights to Tokyo';
const DESTINATION = 'Tokyo';
const FLIGHT_CALL_ID = 'call_flights_1';
const FLIGHTS_TOOL = NAMED_TOOLS.getFlights.name;
/** How the side panel names `get_flights` of frame 0 for the model. */
const ENCODED_FLIGHTS_TOOL = frame0ToolName(FLIGHTS_TOOL);

/** Enough paragraphs to overflow the 520px-tall side panel. */
const LONG_REPLY = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i + 1}: Flight WM101 to ${DESTINATION} is available for $650 with non-stop service and full WebMCP itinerary support.`
).join('\n\n');

/**
 * Wraps `Element.prototype.scrollIntoView` in the side panel to record every
 * call the app makes, then performs the scroll with `behavior: 'instant'`.
 *
 * The headless side panel tab is hidden (the test page is the active tab), and
 * hidden documents do not run smooth-scroll animations, so the app's
 * `{ behavior: 'smooth' }` call would otherwise never move the list. Only the
 * animation is replaced: the target element and the call itself are the app's.
 */
async function installScrollIntoViewSpy(sidebar: Page): Promise<void> {
  await evaluate(sidebar, `(() => {
      if (window.__scrollIntoViewCalls) return;
      window.__scrollIntoViewCalls = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (arg) {
        const list = document.querySelector('.chat-card__messages');
        window.__scrollIntoViewCalls.push({
          isListEnd: Boolean(list) && list.lastElementChild === this,
          overflowing: Boolean(list) && list.scrollHeight > list.clientHeight,
        });
        const options = typeof arg === 'object' && arg !== null ? { ...arg, behavior: 'instant' } : arg;
        return original.call(this, options);
      };
    })()`
  );
}

describe('Smoke — Chat & Read-Only Tool Execution', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  let session: SmokeSessionContext;

  before(async () => {
    session = await createSmokeSession({ dismissConsent: true });
    const { server, sidebar } = session;

    // Turn 1: the model calls the read-only tool. Turn 2: it answers with a long reply.
    server.enqueueReplies(
      {
        chatId: CHAT_ID,
        text: '',
        functionCalls: [
          { id: FLIGHT_CALL_ID, name: ENCODED_FLIGHTS_TOOL, args: { destination: DESTINATION } },
        ],
      },
      { chatId: CHAT_ID, textChunks: ['Here are the flights I found:\n\n', LONG_REPLY] }
    );

    await installScrollIntoViewSpy(sidebar);
    await submitPromptInSidebar(sidebar, PROMPT);
    await waitForCondition(
      () =>
        evaluate<boolean>(sidebar, `Boolean(
            document.querySelector('.user-bubble')?.textContent?.includes(${JSON.stringify(PROMPT)}) &&
            document.querySelector('.ai-response')?.textContent?.includes('Paragraph 12:')
          )`
        ),
      'the prompt and the full streamed AI reply to render'
    );
  });

  after(async () => {
    await session?.close();
  });

  it('runs the read-only tool on the page, without a permission prompt, with the model\'s arguments', async () => {
    const { page, sidebar } = session;
    const executed = await waitForExecutedToolCount(page, 1);
    assert.deepEqual(executed, [{ name: FLIGHTS_TOOL, args: { destination: DESTINATION } }]);

    const cardShown = await evaluate<boolean>(sidebar, `Boolean(document.querySelector('.tool-permission-card'))`
    );
    assert.equal(cardShown, false, 'A read-only tool must not ask for permission');
  });

  it('sends the tool result back to the model on the follow-up turn', async () => {
    const { server } = session;
    assert.equal(server.chatRequests.length, 2, 'Expected the prompt turn and one tool-response turn');
    assert.equal(server.pendingReplyCount(), 0, 'Both queued model turns should have been used');
    assert.equal(server.chatRequests[0].message, PROMPT);

    const followUp = server.chatRequests[1];
    assert.equal(followUp.chatId, CHAT_ID, 'Follow-up turn must continue the same chat');
    const toolResponses = followUp.toolResponses ?? [];
    assert.equal(toolResponses.length, 1, 'Follow-up turn should carry exactly one tool response');

    const { functionResponse } = toolResponses[0];
    assert.equal(functionResponse.id, FLIGHT_CALL_ID);
    assert.equal(functionResponse.name, ENCODED_FLIGHTS_TOOL);
    assert.equal(functionResponse.response.error, undefined);

    // The page builds its result from the arguments it received, so finding the
    // destination here proves the page's real output reached the model.
    const result = functionResponse.response.result;
    const resultText = typeof result === 'string' ? result : JSON.stringify(result);
    assert.ok(resultText?.includes('WM101'), `Tool result should carry the flight, got: ${resultText}`);
    assert.ok(resultText?.includes(DESTINATION), `Tool result should echo the destination, got: ${resultText}`);

    // Nothing ran twice.
    assert.equal((await readExecutedTools(session.page)).length, 1, 'get_flights should have run exactly once');
  });

  it('auto-scrolls the overflowing message list to the newest message', async () => {
    const { sidebar } = session;
    // The test never scrolls the list itself: every scroll comes from the app's
    // own scrollIntoView() calls, recorded by the spy installed before the prompt.
    const metrics = await waitForCondition(
      () =>
        evaluate<{
          overflowY: string;
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
          appCallsOnOverflowingList: number;
        } | null>(sidebar, `(() => {
            const list = document.querySelector('.chat-card__messages');
            if (!list) return null;
            const calls = window.__scrollIntoViewCalls || [];
            // Calls that targeted the end of the message list once it overflowed.
            const appCallsOnOverflowingList = calls.filter((c) => c.isListEnd && c.overflowing).length;
            const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
            if (appCallsOnOverflowingList === 0 || !atBottom) return null;
            return {
              overflowY: window.getComputedStyle(list).overflowY,
              scrollTop: list.scrollTop,
              scrollHeight: list.scrollHeight,
              clientHeight: list.clientHeight,
              appCallsOnOverflowingList,
            };
          })()`
        ),
      'the app to scrollIntoView() the end of the overflowing .chat-card__messages list'
    );

    assert.equal(metrics.overflowY, 'auto', '.chat-card__messages must use overflow-y: auto to scroll');
    assert.ok(
      metrics.scrollHeight > metrics.clientHeight,
      `Expected the long reply to overflow (scrollHeight ${metrics.scrollHeight} > clientHeight ${metrics.clientHeight})`
    );
    assert.ok(metrics.scrollTop > 0, 'The app should have scrolled the list away from the top');
  });

  it('expands the ActionLog to list the executed tool', async () => {
    const { sidebar } = session;
    await clickOrThrow(sidebar, 'button.action-log__header');

    const labels = await waitForCondition(
      () =>
        evaluate<string[] | null>(sidebar, `(() => {
            const items = [...document.querySelectorAll('.action-log__item-label')].map((el) => el.textContent?.trim() || '');
            return items.length > 0 ? items : null;
          })()`
        ),
      'ActionLog to expand and display executed tool labels'
    );
    assert.ok(
      labels.includes('Get flights'),
      `Expected expanded ActionLog to include "Get flights", got: ${JSON.stringify(labels)}`
    );
  });
});
