/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { DEFAULT_TOOL_ROUND_LIMITS, ToolRoundLimitError } from '../../extension/sidepanel/services/toolRoundLimits.js';
import { ToolCheckpointCard } from '../../extension/sidepanel/components/ToolCheckpointCard.js';
import { ChatBubble } from '../../extension/sidepanel/components/ChatBubble.js';
import { tabSessions } from '../../extension/sidepanel/services/tabSessionStore.js';
import { UserFacingError } from '../../extension/sidepanel/types/index.js';

/**
 * Finds a rendered element by class name in a returned element tree, so a test
 * can call the handler the component attached rather than the callback it was
 * given, which would pass even if the `onClick` were missing.
 */
function findByClass(node: unknown, className: string): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as { props?: { className?: unknown; children?: unknown } };
  if (typeof el.props?.className === 'string' && el.props.className.includes(className)) {
    return el as { props: Record<string, unknown> };
  }
  const children = el.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test('by default the agent asks once after 10 rounds of tool calls and stops at 100', () => {
  assert.deepEqual(DEFAULT_TOOL_ROUND_LIMITS, { askAfter: 10, max: 100 });
});

test('reaching the limit is told to the user in plain words, with what to do next', () => {
  const error = new ToolRoundLimitError(100);
  // Shown in the chat as it is, whoever reached the limit.
  assert.ok(error instanceof UserFacingError);
  assert.equal(error.name, 'ToolRoundLimitError');
  assert.equal(
    error.message,
    'The agent stopped after using tools 100 times, the most allowed for one request. Try asking again, or split the task into smaller steps.'
  );
});

test('ToolCheckpointCard is drawn from the permission card parts and says where it stops', () => {
  const html = renderToString(
    React.createElement(ToolCheckpointCard, { roundsUsed: 10, maxRounds: 100, onAllow: () => {}, onDeny: () => {} })
  );

  // The same card as a permission prompt, so waiting on the user always looks alike.
  assert.ok(html.includes('class="tool-permission-card"'));
  assert.ok(html.includes('tool-permission-card__box'));
  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes('aria-labelledby="checkpoint-title"'));
  assert.ok(html.includes('aria-describedby="checkpoint-details"'));

  assert.ok(html.includes('Keep going?'));
  assert.ok(html.includes('Used tools 10 times'));
  assert.ok(html.includes('If you continue, it can use tools up to 100 times in total, then it stops.'));
  assert.ok(html.includes('>Stop</button>'));
  assert.ok(html.includes('>Continue</button>'));
});

test('ToolCheckpointCard wires Continue and Stop to their own buttons', () => {
  let allowed = 0;
  let denied = 0;
  const card = ToolCheckpointCard({
    roundsUsed: 10,
    maxRounds: 100,
    onAllow: () => {
      allowed++;
    },
    onDeny: () => {
      denied++;
    },
  });

  const continueButton = findByClass(card, 'tool-permission-card__btn--allow');
  const stopButton = findByClass(card, 'tool-permission-card__btn--deny');
  assert.ok(continueButton && stopButton, 'both buttons should be rendered');

  (continueButton!.props.onClick as () => void)();
  assert.deepEqual([allowed, denied], [1, 0]);
  (stopButton!.props.onClick as () => void)();
  assert.deepEqual([allowed, denied], [1, 1]);
});

test('ChatBubble swaps the input for the checkpoint card, as it does for a permission prompt', () => {
  const checkpointProps = { roundsUsed: 10, maxRounds: 100, onAllow: () => {}, onDeny: () => {} };

  const html = renderToString(
    React.createElement(ChatBubble, {
      showTab: true,
      tabProps: { domain: 'shopping.com', toolsCountLabel: '2 tools', hasTools: true },
      checkpointProps,
    })
  );
  assert.ok(html.includes('shopping.com'));
  assert.ok(html.includes('Keep going?'));
  assert.ok(html.includes('chat-bubble--permission'));
  assert.ok(!html.includes('chat-bubble__input-field'));

  // Only one prompt is ever on screen. A permission prompt is answered first.
  const both = renderToString(
    React.createElement(ChatBubble, {
      permissionProps: { toolName: 'checkout_cart', onAllow: () => {}, onDeny: () => {} },
      checkpointProps,
    })
  );
  assert.ok(both.includes('Allow tool actions'));
  assert.ok(!both.includes('Keep going?'));
});

test('starting a new chat puts away a waiting checkpoint', () => {
  const tabId = 4242;
  tabSessions.update(tabId, {
    busy: true,
    pendingCheckpoint: { roundsUsed: 10, maxRounds: 100, allow: () => {}, deny: () => {} },
  });
  try {
    // On the on-device path, so ending the chat makes no request.
    tabSessions.resetChat(tabId, { onDevice: true });
    assert.equal(tabSessions.getState(tabId).pendingCheckpoint, null);
    assert.equal(tabSessions.getState(tabId).busy, false);
  } finally {
    tabSessions.remove(tabId, { onDevice: true });
  }
});
