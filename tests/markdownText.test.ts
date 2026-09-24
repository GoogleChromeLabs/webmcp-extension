/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MarkdownText } from '../src/sidepanel/components/MarkdownText.js';

test('parseInline parses bold, italic, code, and markdown links', () => {
  const text = '**Bold** *Italic* `code` [Link](https://example.com)';
  const html = renderToString(React.createElement(MarkdownText, { content: text }));

  assert.ok(html.includes('<strong>Bold</strong>'));
  assert.ok(html.includes('<em>Italic</em>'));
  assert.ok(html.includes('<code class="md-inline-code">code</code>'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('Link'));
});

test('MarkdownText renders ordered lists with start attribute when interrupted by sub-lists', () => {
  const text = `1. **Hotel Alpha**
   * Rating: 4.9
   * Price: $200

2. **Hotel Beta**
   * Rating: 4.8
   * Price: $180

3. **Hotel Gamma**
   * Rating: 4.5`;

  const html = renderToString(React.createElement(MarkdownText, { content: text }));

  assert.ok(html.includes('<ol class="md-ol" start="1">'));
  assert.ok(html.includes('<ol class="md-ol" start="2">'));
  assert.ok(html.includes('<ol class="md-ol" start="3">'));
  assert.ok(html.includes('Hotel Alpha'));
  assert.ok(html.includes('Hotel Beta'));
  assert.ok(html.includes('Hotel Gamma'));
});
