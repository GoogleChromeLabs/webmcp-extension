/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HTTPRequest } from 'puppeteer-core';
import { createSmokeSession, smokeSkipReason } from './chromeHarness.js';
import {
  clickOrThrow,
  frame0ToolName,
  readExecutedTools,
  submitPromptInSidebar,
  SELECTORS,
  SIDEBAR_POLLING,
} from './sidePanelHelpers.js';
import { NAMED_TOOLS } from './smokeServer.js';

describe('Smoke — Tool History', { skip: smokeSkipReason(), timeout: 60_000 }, () => {
  for (const ending of ['toolbar Stop', 'error'] as const) {
    it(`keeps tool-only history after ${ending}`, async () => {
      const session = await createSmokeSession({ dismissConsent: true });
      const { server, page, sidebar } = session;
      const isFollowup = (request: HTTPRequest) =>
        request.url().endsWith('/api/chat') && Boolean(request.postData()?.includes('"toolResponses"'));

      try {
        // Hold the follow-up until the tool has run, then stop or fail it.
        // The first model reply still goes through the real smoke server.
        await sidebar.setRequestInterception(true);
        sidebar.on('request', (request) => {
          if (!isFollowup(request)) {
            void request.continue();
          }
        });
        server.enqueueReplies({
          text: '',
          functionCalls: [{ name: frame0ToolName(NAMED_TOOLS.getFlights.name), args: { destination: 'Tokyo' } }],
        });
        const [pending] = await Promise.all([
          sidebar.waitForRequest(isFollowup),
          submitPromptInSidebar(sidebar, 'Find flights to Tokyo'),
        ]);
        assert.equal((await readExecutedTools(page)).length, 1);

        if (ending === 'toolbar Stop') {
          await clickOrThrow(sidebar, 'button[aria-label="stop"]');
        } else {
          await pending.respond({
            status: 200,
            contentType: 'application/x-ndjson',
            body: `${JSON.stringify({ error: 'Internal failure details' })}\n`,
          });
        }
        await sidebar.waitForFunction(
          (selectors) =>
            Boolean(document.querySelector(selectors.composerInput)) &&
            !document.querySelector('button[aria-label="stop"]') &&
            document.querySelectorAll('.action-log__header[aria-expanded="false"]').length === 1,
          SIDEBAR_POLLING,
          SELECTORS
        );
        assert.equal(await sidebar.$$eval('.ai-response', (replies) => replies.length), 0);
        assert.equal(await sidebar.$$eval('.msg.error', (errors) => errors.length), ending === 'error' ? 1 : 0);
        await clickOrThrow(sidebar, '.action-log__header');
        const labels = await sidebar.$$eval('.action-log__item-label', (items) => items.map((item) => item.textContent?.trim()));
        assert.deepEqual(labels, ['Get flights']);
        assert.equal(await sidebar.$$eval('.action-log__item-check', (items) => items.length), 1);
        assert.equal(server.chatRequests.length, 1, 'Only the initial reply should reach the server');
        assert.equal(server.pendingReplyCount(), 0);
        assert.equal((await readExecutedTools(page)).length, 1);
      } finally {
        await session.close();
      }
    });
  }
});
