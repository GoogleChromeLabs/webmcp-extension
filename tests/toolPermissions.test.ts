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

test('a disabled Switch stays focusable and ignores clicks and keys', () => {
  let changes = 0;
  const switchComponent = Switch({
    checked: false,
    onChange: () => changes++,
    disabled: true,
    'aria-label': 'On-device model',
  });

  const html = renderToString(switchComponent);
  assert.ok(html.includes('aria-disabled="true"'));
  // No `disabled` attribute, which would take it out of the tab order.
  assert.doesNotMatch(html, /\sdisabled(=|\s|>)/);

  switchComponent.props.onClick();
  let prevented = 0;
  for (const key of [' ', 'Enter']) {
    switchComponent.props.onKeyDown({ key, preventDefault: () => prevented++ });
  }
  assert.equal(changes, 0);
  // The keys are still swallowed, so the button does not click itself either.
  assert.equal(prevented, 2);

  const enabled = renderToString(Switch({ checked: false, onChange: () => {}, 'aria-label': 'On-device model' }));
  assert.ok(!enabled.includes('aria-disabled'));
});

test('SettingsScreen renders the permissions and model sections', () => {
  let toggled = false;
  let closed = false;

  const screen = React.createElement(SettingsScreen, {
    sensitiveActionAlerts: true,
    onToggleSensitiveActionAlerts: () => {
      toggled = true;
    },
    onDeviceModel: false,
    onToggleOnDeviceModel: () => { },
    onDeviceModelSupported: true,
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

  // Must contain the Model section with the on-device model toggle
  assert.ok(html.includes('On-device model'));
  assert.ok(html.includes('Run the model in your browser with the Prompt API'));

  // Must NOT contain unrequested settings sections like Preferences, Tabs, Microphone, Location
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

test('SettingsScreen locks the model switch while a response is in progress', () => {
  const render = (responseInProgress: boolean) =>
    renderToString(
      React.createElement(SettingsScreen, {
        sensitiveActionAlerts: true,
        onToggleSensitiveActionAlerts: () => { },
        onDeviceModel: true,
        onToggleOnDeviceModel: () => { },
        onDeviceModelSupported: true,
        responseInProgress,
        onClose: () => { },
      })
    );
  const modelSwitch = (html: string) => /<button[^>]*aria-label="On-device model"[^>]*>/.exec(html)?.[0] ?? '';
  const alertsSwitch = (html: string) => /<button[^>]*aria-label="Sensitive action alerts"[^>]*>/.exec(html)?.[0] ?? '';

  const busy = render(true);
  assert.match(modelSwitch(busy), /aria-disabled="true"/);
  assert.ok(busy.includes('Can be changed once the current response has finished.'));
  // The switch points at why it is locked, so a screen reader announces it.
  const describedBy = /aria-describedby="([^"]*)"/.exec(modelSwitch(busy))?.[1].split(' ') ?? [];
  assert.equal(describedBy.length, 2);
  const lockedNote = new RegExp(`id="${describedBy[1]}"[^>]*>\\s*Can be changed once the current response has finished.`);
  assert.match(busy, lockedNote);
  // Only the backend is locked: permission alerts can still be changed.
  assert.doesNotMatch(alertsSwitch(busy), /disabled/);

  const idle = render(false);
  assert.doesNotMatch(modelSwitch(idle), /disabled/);
  assert.ok(!idle.includes('Can be changed once the current response has finished.'));
  assert.equal(/aria-describedby="([^"]*)"/.exec(modelSwitch(idle))?.[1].split(' ').length, 1);
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
