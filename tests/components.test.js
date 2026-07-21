import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { ModelPickerDropdown, MODEL_DISPLAY_NAMES } from '../src/components/ModelPicker.jsx';
import { ButtonUI } from '../src/components/ButtonUI.jsx';
import { IPHPopover } from '../src/components/IPHPopover.jsx';
import { WebMCPToolsDialogue } from '../src/components/WebMCPToolsDialogue.jsx';
import { MarkdownText } from '../src/components/MarkdownText.jsx';

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
  assert.ok(html.includes('nexus-model-dropdown__item--selected'));
});

test('ButtonUI renders Play Arrow and Square Stop buttons', () => {
  const playHtml = renderToString(
    React.createElement(ButtonUI, {
      type: 'Send Button',
      state: 'Default',
    })
  );
  assert.ok(playHtml.includes('nexus-button-ui'));

  const stopHtml = renderToString(
    React.createElement(ButtonUI, {
      type: 'Stop Button',
      state: 'Default',
    })
  );
  assert.ok(stopHtml.includes('nexus-button-ui'));
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
      onOpenDetails: () => {},
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
  assert.ok(html.includes('<ul class="md-ul">'));
  assert.ok(html.includes('Item 1'));
  assert.ok(html.includes('href="https://google.com"'));
  assert.ok(html.includes('code_block'));
});
