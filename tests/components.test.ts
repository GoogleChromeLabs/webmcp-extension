/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { ButtonUI } from '../src/components/ButtonUI.js';
import { IPHPopover } from '../src/components/IPHPopover.js';
import { WebMCPToolsDialogue } from '../src/components/WebMCPToolsDialogue.js';
import { MarkdownText } from '../src/components/MarkdownText.js';
import { ActionLog, formatLogLabel } from '../src/components/ActionLog.js';
import { AttachedTab } from '../src/components/AttachedTab.js';
import { ActionsChip } from '../src/components/ActionsChip.js';
import { TextInput } from '../src/components/TextInput.js';
import { Toolbar } from '../src/components/Toolbar.js';
import { ChatBubble } from '../src/components/ChatBubble.js';
import { ConsentScreen } from '../src/screens/ConsentScreen.js';
import { Favicon } from '../src/components/Favicon.js';
import { Switch } from '../src/components/Switch.js';
import { SettingsScreen } from '../src/screens/SettingsScreen.js';
import { AllowToolPermissionCard } from '../src/components/AllowToolPermissionCard.js';

test('ButtonUI renders Play Arrow and Square Stop buttons with distinct accessible labels and icons', () => {
  const playHtml = renderToString(
    React.createElement(ButtonUI, {
      variant: 'send',
    })
  );
  assert.ok(playHtml.includes('button-ui'));
  assert.ok(playHtml.includes('aria-label="send"'));
  assert.ok(playHtml.includes('<svg'));

  const stopHtml = renderToString(
    React.createElement(ButtonUI, {
      variant: 'stop',
      pressed: true,
    })
  );
  assert.ok(stopHtml.includes('button-ui'));
  assert.ok(stopHtml.includes('button-ui--pressed'));
  assert.ok(stopHtml.includes('aria-label="stop"'));
  assert.ok(stopHtml.includes('<svg'));
});

test('IPHPopover renders dark blue IPH card text', () => {
  const html = renderToString(
    React.createElement(IPHPopover, {
      onClose: () => {},
      onViewActions: () => {},
      onGotIt: () => {},
    })
  );

  assert.ok(html.includes('Available WebMCP tools'));
  assert.ok(html.includes('View actions'));
  assert.ok(html.includes('Got it'));
});

test('WebMCPToolsDialogue renders tools count and tools list', () => {
  const html = renderToString(
    React.createElement(WebMCPToolsDialogue, {
      domain: 'example.com',
      toolsCount: 2,
      toolsList: ['Search hotels', 'Filter gym'],
      onClose: () => {},
    })
  );

  assert.ok(html.includes('example.com'));
  assert.ok(html.includes('Search hotels'));
  assert.ok(html.includes('Filter gym'));
});

test('MarkdownText renders formatted HTML headers, lists, code, and links', () => {
  const markdown = '# Heading 1\n\n- Item 1\n- Item 2\n\nVisit [Example](https://example.com) `code_block`';
  const html = renderToString(
    React.createElement(MarkdownText, { content: markdown })
  );

  assert.ok(html.includes('Heading 1'));
  assert.ok(html.includes('class="md-h1"'));
  assert.ok(html.includes('<ul class="md-ul"'));
  assert.ok(html.includes('Item 1'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('code_block'));
});

test('formatLogLabel formats tool names into human readable labels', () => {
  assert.equal(formatLogLabel('apply_filters'), 'Apply filters');
  assert.equal(formatLogLabel('filter_parameters_for_application'), 'Filter parameters for application');
  assert.equal(formatLogLabel(''), 'Thinking...');
});

test('ActionLog renders initiation, running, and completed states', () => {
  // 1. Initiation
  const initHtml = renderToString(
    React.createElement(ActionLog, {
      status: 'initiation',
    })
  );
  assert.ok(initHtml.includes('Just a sec...'));
  assert.ok(initHtml.includes('action-log__dots'));

  // 2. Running
  const runningHtml = renderToString(
    React.createElement(ActionLog, {
      status: 'running',
      activityLogs: [
        { id: 1, time: '12:00', source: 'assistant', name: 'apply_filters', args: {}, start: 0, status: 'ok' },
        { id: 2, time: '12:01', source: 'assistant', name: 'search_items', args: {}, start: 0, status: 'running' },
      ],
      defaultOpen: true,
    })
  );
  assert.ok(runningHtml.includes('Apply filters...'));
  assert.ok(runningHtml.includes('action-log__item-check'));
  assert.ok(runningHtml.includes('action-log__item-circle'));

  // 3. Completed
  const completedHtml = renderToString(
    React.createElement(ActionLog, {
      status: 'completed',
      activityLogs: [
        { id: 1, time: '12:00', source: 'assistant', name: 'apply_filters', args: {}, start: 0, status: 'ok' },
      ],
      defaultOpen: true,
    })
  );
  assert.ok(completedHtml.includes('Show thinking'));
  assert.ok(completedHtml.includes('Apply filters'));
});

test('AttachedTab renders domain and tools count label conditionally', () => {
  const openHtml = renderToString(
    React.createElement(AttachedTab, {
      domain: 'example.com',
      toolsCountLabel: '3 tools',
      hasTools: true,
      isOpen: true,
    })
  );

  assert.ok(openHtml.includes('example.com'));
  assert.ok(openHtml.includes('3 tools'));
  assert.ok(openHtml.includes('attached-tab--open'));

  const noToolsHtml = renderToString(
    React.createElement(AttachedTab, {
      domain: 'example.com',
      hasTools: false,
    })
  );
  assert.ok(noToolsHtml.includes('example.com'));
  assert.ok(!noToolsHtml.includes('actions-chip'));
});

test('ActionsChip renders label and automation icon', () => {
  const html = renderToString(
    React.createElement(ActionsChip, {
      label: '4 tools',
      state: 'Closed',
    })
  );

  assert.ok(html.includes('actions-chip'));
  assert.ok(html.includes('4 tools'));
});

test('TextInput and ChatBubble render cleanly', () => {
  const textHtml = renderToString(
    React.createElement(TextInput, {
      value: 'Hello Agent',
      placeholder: 'Ask Agent anything',
      onChange: () => {},
    })
  );
  assert.ok(textHtml.includes('Hello Agent'));

  const bubbleHtml = renderToString(
    React.createElement(ChatBubble, {
      showTab: true,
      tabProps: { domain: 'example.com', toolsCountLabel: '2 tools' },
      textProps: { value: 'test', onChange: () => {} },
      toolbarProps: { actionVariant: 'send' },
    })
  );
  assert.ok(bubbleHtml.includes('chat-bubble'));
  assert.ok(bubbleHtml.includes('example.com'));
});

test('ConsentScreen renders feature cards, disclaimers, and action buttons', () => {
  const html = renderToString(
    React.createElement(ConsentScreen, {
      onGotIt: () => {},
      onClose: () => {},
    })
  );

  assert.ok(html.includes('Reach your goals, faster'));
  assert.ok(html.includes('Use it on trusted sites'));
  assert.ok(html.includes('Stay in control'));
  assert.ok(html.includes('Terms &amp; Notices'));
  assert.ok(html.includes('Got it'));
  assert.ok(html.includes('Close'));
});

test('Favicon renders customSrc and fallback gracefully', () => {
  const customHtml = renderToString(
    React.createElement(Favicon, {
      customSrc: 'https://example.com/icon.png',
    })
  );
  assert.ok(customHtml.includes('https://example.com/icon.png'));
  assert.ok(customHtml.includes('fav__img'));

  const fallbackHtml = renderToString(React.createElement(Favicon));
  assert.ok(fallbackHtml.includes('data:image/svg+xml'));
});

test('MarkdownText sanitizes malicious javascript links', () => {
  const markdown = '[Click Me](javascript:alert(1)) and [Legit](https://example.com)';
  const html = renderToString(
    React.createElement(MarkdownText, { content: markdown })
  );

  assert.ok(!html.includes('javascript:alert(1)'));
  assert.ok(html.includes('href="#"'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('ActionLog renders aria-expanded and aria-controls for accessibility', () => {
  const html = renderToString(
    React.createElement(ActionLog, {
      status: 'completed',
      activityLogs: [
        { id: 1, time: '12:00', source: 'assistant', name: 'search_items', args: {}, start: 0, status: 'ok' },
      ],
      defaultOpen: true,
    })
  );

  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes('aria-controls='));
});

test('Switch renders checked and unchecked states with accessibility attributes', () => {
  const checkedHtml = renderToString(
    React.createElement(Switch, {
      checked: true,
      onChange: () => { },
      'aria-label': 'Test Switch',
    })
  );
  assert.ok(checkedHtml.includes('cdds-switch--checked'));
  assert.ok(checkedHtml.includes('role="switch"'));
  assert.ok(checkedHtml.includes('aria-checked="true"'));
  assert.ok(checkedHtml.includes('aria-label="Test Switch"'));

  const uncheckedHtml = renderToString(
    React.createElement(Switch, {
      checked: false,
      onChange: () => { },
      'aria-label': 'Test Switch',
    })
  );
  assert.ok(!uncheckedHtml.includes('cdds-switch--checked'));
  assert.ok(uncheckedHtml.includes('aria-checked="false"'));
});

test('SettingsScreen renders header, permissions section, sensitive action alerts, and switch', () => {
  const html = renderToString(
    React.createElement(SettingsScreen, {
      sensitiveActionAlerts: true,
      onToggleSensitiveActionAlerts: () => { },
      onDeviceModel: false,
      onToggleOnDeviceModel: () => { },
      onDeviceModelSupported: true,
      onClose: () => { },
    })
  );

  assert.ok(html.includes('Settings'));
  assert.ok(html.includes('Permissions'));
  assert.ok(html.includes('Sensitive action alerts'));
  assert.ok(html.includes('Get a prompt before tools make changes to your data or accounts'));
  assert.ok(html.includes('aria-label="Close settings"'));
  assert.ok(html.includes('cdds-switch--checked'));
});

test('AllowToolPermissionCard renders shield icon, title, tool details, and allow/deny buttons', () => {
  const html = renderToString(
    React.createElement(AllowToolPermissionCard, {
      toolName: 'book_table',
      toolDescription: 'Books a restaurant reservation at the selected time.',
      onAllow: () => { },
      onDeny: () => { },
    })
  );

  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('Let this tool complete task for you'));
  assert.ok(html.includes('book_table'));
  assert.ok(html.includes('Books a restaurant reservation at the selected time.'));
  assert.ok(html.includes('Don’t allow'));
  assert.ok(html.includes('Allow'));
});

test('Toolbar renders settings gear button when onSettingsClick is provided', () => {
  const withSettingsHtml = renderToString(
    React.createElement(Toolbar, {
      actionVariant: 'live',
      onSettingsClick: () => { },
    })
  );
  assert.ok(withSettingsHtml.includes('toolbar__settings-btn'));
  assert.ok(withSettingsHtml.includes('aria-label="Settings"'));

  const withoutSettingsHtml = renderToString(
    React.createElement(Toolbar, {
      actionVariant: 'live',
    })
  );
  assert.ok(!withoutSettingsHtml.includes('toolbar__settings-btn'));
});

test('ChatBubble renders AllowToolPermissionCard when permissionProps is passed', () => {
  const permissionBubbleHtml = renderToString(
    React.createElement(ChatBubble, {
      showTab: true,
      tabProps: { domain: 'restaurant.com', toolsCountLabel: '1 tool' },
      permissionProps: {
        toolName: 'create_reservation',
        toolDescription: 'Create dinner booking',
        onAllow: () => { },
        onDeny: () => { },
      },
    })
  );

  assert.ok(permissionBubbleHtml.includes('chat-bubble--permission'));
  assert.ok(permissionBubbleHtml.includes('restaurant.com'));
  assert.ok(permissionBubbleHtml.includes('Allow tool actions'));
  assert.ok(permissionBubbleHtml.includes('create_reservation'));
  assert.ok(permissionBubbleHtml.includes('Create dinner booking'));
  assert.ok(!permissionBubbleHtml.includes('chat-bubble__input-field'));
});

test('ActionLog renders Waiting for permission state with atom logo and header', () => {
  const html = renderToString(
    React.createElement(ActionLog, {
      status: 'permission',
      statusText: 'Waiting for permission',
      activityLogs: [
        { id: 1, time: '12:00', source: 'assistant', name: 'delete_account', args: {}, start: 0, status: 'running' },
      ],
      defaultOpen: true,
    })
  );

  assert.ok(html.includes('Waiting for permission'));
  assert.ok(html.includes('Delete account'));
});


