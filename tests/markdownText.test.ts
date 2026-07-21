/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MarkdownText } from '../src/components/MarkdownText.js';

test('parseInline parses bold, italic, code, and markdown links', () => {
  const text = '**Bold** *Italic* `code` [Link](https://example.com)';
  const html = renderToString(React.createElement(MarkdownText, { content: text }));

  assert.ok(html.includes('<strong>Bold</strong>'));
  assert.ok(html.includes('<em>Italic</em>'));
  assert.ok(html.includes('<code class="md-inline-code">code</code>'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('Link'));
});
