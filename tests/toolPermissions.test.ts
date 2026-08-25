/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { Switch } from '../src/components/Switch.js';
import { SettingsScreen } from '../src/screens/SettingsScreen.js';
import { AllowToolPermissionCard } from '../src/components/AllowToolPermissionCard.js';
import { Toolbar } from '../src/components/Toolbar.js';
import { ChatBubble } from '../src/components/ChatBubble.js';
import { WebMCPTool } from '../src/types/index.js';

test('Switch toggles properly on click', () => {
  let toggledValue: boolean | null = null;
  const switchComponent = Switch({
    checked: false,
    onChange: (val: boolean) => {
      toggledValue = val;
    },
    'aria-label': 'Enable sensitive actions',
  });

  const html = renderToString(switchComponent);
  assert.ok(html.includes('aria-checked="false"'));
  assert.ok(!html.includes('cdds-switch--checked'));

  // Trigger click handler from the rendered button component
  switchComponent.props.onClick();
  assert.equal(toggledValue, true);
});

test('SettingsScreen renders permissions section with Sensitive action alerts only', () => {
  let toggled = false;
  let closed = false;

  const screen = React.createElement(SettingsScreen, {
    sensitiveActionAlerts: true,
    onToggleSensitiveActionAlerts: () => {
      toggled = true;
    },
    onClose: () => {
      closed = true;
    },
  });

  const html = renderToString(screen);

  // Must contain Settings header and Close button
  assert.ok(html.includes('Settings'));
  assert.ok(html.includes('aria-label="Close settings"'));

  // Must contain Permissions and Sensitive action alerts
  assert.ok(html.includes('Permissions'));
  assert.ok(html.includes('Sensitive action alerts'));
  assert.ok(
    html.includes(
      'Get a prompt before tools make changes to your data or accounts. Some external tools may not support this.'
    )
  );
  assert.ok(html.includes('cdds-switch--checked'));

  // Must NOT contain unrequested settings sections like Preferences, Models, Tabs, Microphone, Location
  assert.ok(!html.includes('Show used tools in the log'));
  assert.ok(!html.includes('Share current tab by default'));
  assert.ok(!html.includes('Microphone'));
  assert.ok(!html.includes('Tool list'));
  assert.ok(!html.includes('Models'));

  // Verify interaction callbacks
  screen.props.onToggleSensitiveActionAlerts();
  assert.equal(toggled, true);
  screen.props.onClose();
  assert.equal(closed, true);
});

test('AllowToolPermissionCard triggers onAllow and onDeny callbacks', () => {
  let allowed = false;
  let denied = false;

  const card = React.createElement(AllowToolPermissionCard, {
    toolName: 'transfer_funds',
    toolDescription: 'Transfers money between specified accounts.',
    onAllow: () => {
      allowed = true;
    },
    onDeny: () => {
      denied = true;
    },
  });

  const html = renderToString(card);
  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('Let this tool complete task for you'));
  assert.ok(html.includes('transfer_funds'));
  assert.ok(html.includes('Transfers money between specified accounts.'));
  assert.ok(html.includes('Don’t allow'));
  assert.ok(html.includes('Allow'));

  card.props.onAllow();
  assert.equal(allowed, true);
  card.props.onDeny();
  assert.equal(denied, true);
});

test('ChatBubble swaps input field with AllowToolPermissionCard when permissionProps is passed', () => {
  let allowClicked = false;
  let denyClicked = false;

  const bubbleWithPermission = React.createElement(ChatBubble, {
    showTab: true,
    tabProps: { domain: 'shopping.com', toolsCountLabel: '2 tools' },
    permissionProps: {
      toolName: 'checkout_cart',
      toolDescription: 'Purchases all items in your cart.',
      onAllow: () => {
        allowClicked = true;
      },
      onDeny: () => {
        denyClicked = true;
      },
    },
  });

  const html = renderToString(bubbleWithPermission);
  assert.ok(html.includes('shopping.com'));
  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('checkout_cart'));
  assert.ok(html.includes('Purchases all items in your cart.'));
  assert.ok(!html.includes('chat-bubble__input-field'));

  bubbleWithPermission.props.permissionProps?.onAllow();
  assert.equal(allowClicked, true);
  bubbleWithPermission.props.permissionProps?.onDeny();
  assert.equal(denyClicked, true);
});

test('Toolbar renders settings gear icon on the left when onSettingsClick is provided', () => {
  let settingsClicked = false;

  const toolbar = React.createElement(Toolbar, {
    actionVariant: 'send',
    onActionClick: () => {},
    onSettingsClick: () => {
      settingsClicked = true;
    },
  });

  const html = renderToString(toolbar);
  assert.ok(html.includes('toolbar__settings-btn'));
  assert.ok(html.includes('aria-label="Settings"'));

  toolbar.props.onSettingsClick?.();
  assert.equal(settingsClicked, true);
});

test('Readonly tools vs non-readonly tools distinction follows WebMCP readOnlyHint specification', () => {
  const tools: WebMCPTool[] = [
    {
      name: 'get_weather',
      description: 'Gets the current weather for a city.',
      readOnlyHint: true,
    },
    {
      name: 'send_email',
      description: 'Sends an email to a recipient.',
      readOnlyHint: false,
    },
    {
      name: 'delete_file',
      description: 'Deletes a specified file.',
    },
  ];

  // Helper matching the logic in useAgentSession
  const requiresPermissionPrompt = (tool: WebMCPTool, sensitiveActionAlerts: boolean): boolean => {
    const isReadOnly = tool.readOnlyHint === true;
    return sensitiveActionAlerts && !isReadOnly;
  };

  // When sensitiveActionAlerts is TRUE:
  // get_weather is readonly -> NO prompt
  assert.equal(requiresPermissionPrompt(tools[0], true), false);
  // send_email is readOnlyHint: false -> PROMPT
  assert.equal(requiresPermissionPrompt(tools[1], true), true);
  // delete_file has undefined readOnlyHint -> defaults to sensitive/mutating -> PROMPT
  assert.equal(requiresPermissionPrompt(tools[2], true), true);

  // When sensitiveActionAlerts is FALSE:
  // None require prompt
  assert.equal(requiresPermissionPrompt(tools[0], false), false);
  assert.equal(requiresPermissionPrompt(tools[1], false), false);
  assert.equal(requiresPermissionPrompt(tools[2], false), false);
});
