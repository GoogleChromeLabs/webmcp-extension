/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { ButtonUI } from '../src/components/ButtonUI.js';
import { InProductHelpPopover } from '../src/components/InProductHelpPopover.js';
import { WebMCPToolsDialogue } from '../src/components/WebMCPToolsDialogue.js';
import { MarkdownText } from '../src/components/MarkdownText.js';
import { ActionLog, formatLogLabel } from '../src/components/ActionLog.js';
import { AttachedTab } from '../src/components/AttachedTab.js';
import { TextInput } from '../src/components/TextInput.js';
import { ActionsChip } from '../src/components/ActionsChip.js';
import { ConsentScreen } from '../src/screens/ConsentScreen.js';

test('ButtonUI renders Play Arrow and Square Stop buttons', () => {
  const playHtml = renderToString(
    React.createElement(ButtonUI, {
      type: 'Send Button',
      state: 'Default',
    })
  );
  assert.ok(playHtml.includes('button-ui'));

  const stopHtml = renderToString(
    React.createElement(ButtonUI, {
      type: 'Stop Button',
      state: 'Default',
    })
  );
  assert.ok(stopHtml.includes('button-ui'));
});

test('InProductHelpPopover renders dark blue guidance card text', () => {
  const html = renderToString(
    React.createElement(InProductHelpPopover, {
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

test('ActionLog renders initiation, running, and completed states matching Figma design', () => {
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

test('AttachedTab renders domain without X close button for single tab', () => {
  const html = renderToString(
    React.createElement(AttachedTab, {
      domain: 'example.com',
    })
  );

  assert.ok(html.includes('example.com'));
  assert.ok(!html.includes('attached-tab__close-btn'));
  assert.ok(!html.includes('title="Close tab"'));
});

test('AttachedTab renders domain and tools count label', () => {
  const html = renderToString(
    React.createElement(AttachedTab, {
      domain: 'example.com',
      toolsCountLabel: '3 tools',
      hasTools: true,
    })
  );

  assert.ok(html.includes('example.com'));
  assert.ok(html.includes('3 tools'));
});

test('TextInput renders clean input field without fake cursor DOM elements', () => {
  const html = renderToString(
    React.createElement(TextInput, {
      value: 'Hello Agent',
      placeholder: 'Ask Agent anything',
      active: true,
      readOnly: true,
    })
  );

  assert.ok(html.includes('text-input'));
  assert.ok(html.includes('value="Hello Agent"'));
  assert.ok(html.includes('placeholder="Ask Agent anything"'));
  assert.ok(!html.includes('text-input__cursor'));
});

test('ActionsChip renders enabled and disabled states', () => {
  const enabledHtml = renderToString(
    React.createElement(ActionsChip, {
      disabled: false,
      label: '4 tools',
    })
  );
  assert.ok(enabledHtml.includes('actions-chip--enabled'));
  assert.ok(enabledHtml.includes('4 tools'));

  const disabledHtml = renderToString(
    React.createElement(ActionsChip, {
      disabled: true,
      disabledLabel: 'WebMCP disabled',
    })
  );
  assert.ok(disabledHtml.includes('actions-chip--disabled'));
  assert.ok(disabledHtml.includes('WebMCP disabled'));
});

test('ConsentScreen renders welcome greeting and privacy notices', () => {
  const html = renderToString(
    React.createElement(ConsentScreen, {
      onGotIt: () => {},
    })
  );

  assert.ok(html.includes('consent-view'));
  assert.ok(html.includes('Reach your goals, faster'));
  assert.ok(html.includes('Got it'));
  assert.ok(!html.includes('Close'));
});