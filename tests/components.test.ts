/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { ModelPickerDropdown, MODEL_DISPLAY_NAMES } from '../src/components/ModelPicker.js';
import { ButtonUI } from '../src/components/ButtonUI.js';
import { IPHPopover } from '../src/components/IPHPopover.js';
import { WebMCPToolsDialogue } from '../src/components/WebMCPToolsDialogue.js';
import { MarkdownText } from '../src/components/MarkdownText.js';
import { ActionLog, formatLogLabel } from '../src/components/ActionLog.js';
import { Header } from '../src/components/Header.js';
import { SettingsModal } from '../src/screens/SettingsModal.js';

test('MODEL_DISPLAY_NAMES formats model names to human-readable strings', () => {
  assert.equal(MODEL_DISPLAY_NAMES['gemini-3.5-flash'], 'Gemini 3.5 Flash');
  assert.equal(MODEL_DISPLAY_NAMES['gpt-5.1'], 'GPT 5.1');
  assert.equal(MODEL_DISPLAY_NAMES['claude-opus-4-8'], 'Claude Opus 4.8');
});

test('ModelPickerDropdown renders provider groups and checkmarks correctly', () => {
  const html = renderToString(
    React.createElement(ModelPickerDropdown, {
      selectedProvider: 'gemini',
      selectedModel: 'gemini-3.5-flash',
      onSelectModel: () => {},
      onClose: () => {},
    })
  );

  assert.ok(html.includes('Gemini'));
  assert.ok(html.includes('OpenAI'));
  assert.ok(html.includes('Anthropic'));
  assert.ok(html.includes('Gemini 3.5 Flash'));
  assert.ok(html.includes('model-dropdown__item--selected'));
});

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
      domain: 'booking.com',
      toolsCount: 2,
      toolsList: ['Search hotels', 'Filter gym'],
      onClose: () => {},
    })
  );

  assert.ok(html.includes('booking.com'));
  assert.ok(html.includes('Search hotels'));
  assert.ok(html.includes('Filter gym'));
});

test('MarkdownText renders formatted HTML headers, lists, code, and links', () => {
  const markdown = '# Heading 1\n\n- Item 1\n- Item 2\n\nVisit [Google](https://google.com) `code_block`';
  const html = renderToString(
    React.createElement(MarkdownText, { content: markdown })
  );

  assert.ok(html.includes('Heading 1'));
  assert.ok(html.includes('class="md-h1"'));
  assert.ok(html.includes('<ul class="md-ul"'));
  assert.ok(html.includes('Item 1'));
  assert.ok(html.includes('href="https://google.com"'));
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

test('Header renders right-aligned action controls (Start New Chat, Settings)', () => {
  const html = renderToString(
    React.createElement(Header, {
      onEdit: () => {},
      onSettings: () => {},
    })
  );

  assert.ok(html.includes('title="Start new chat"'));
  assert.ok(html.includes('title="Settings"'));
});

test('SettingsModal renders options section and prompt suggestion toggle without API keys', () => {
  const html = renderToString(
    React.createElement(SettingsModal, {
      isOpen: true,
      suggestPrompt: true,
      onClose: () => {},
      onToggleSuggestPrompt: () => {},
    })
  );

  assert.ok(html.includes('OPTIONS'));
  assert.ok(html.includes('Suggest user prompt'));
  assert.ok(!html.includes('API KEYS'));
});
