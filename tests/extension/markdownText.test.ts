/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// The parser builds nodes with `document.createElement`, so the tests need a
// document before the component module is loaded. It also serializes tokens in
// a document of their own, which linkedom does not offer on its own.
const { document } = parseHTML('<!doctype html><html><body></body></html>');
Object.defineProperty(document, 'implementation', {
  value: {
    createHTMLDocument: () => parseHTML('<!doctype html><html><body></body></html>').document,
  },
});
// A link is resolved against the document it is going into, and linkedom has
// no address to offer. The side panel's own page is where it resolves in
// Chrome, so the tests stand in something a relative URL can resolve against.
Object.defineProperty(document, 'baseURI', { value: 'https://example.test/panel.html' });
(globalThis as unknown as { document: Document }).document = document as unknown as Document;

const { createMarkdownStream } = await import('../../extension/sidepanel/components/MarkdownText.js');

/** The sink appends from a stream, so the nodes land a task later. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element as unknown as HTMLElement;
}

/** Renders `chunks` into a fresh element and returns it, complete. */
async function render(chunks: string[]): Promise<HTMLElement> {
  const element = host();
  const stream = createMarkdownStream(element);
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await settle();
  return element;
}

/** An anchor's attributes, whatever order the serializer puts them in. */
function link(element: HTMLElement): Record<string, string | null> {
  const anchor = element.querySelector('a');
  assert.ok(anchor, element.innerHTML);
  return {
    href: anchor.getAttribute('href'),
    target: anchor.getAttribute('target'),
    rel: anchor.getAttribute('rel'),
    text: anchor.textContent,
  };
}

test('inline Markdown becomes the tags it names', async () => {
  const element = await render(['**Bold** *Italic* `code` [Link](https://example.com)']);
  const html = element.innerHTML;

  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>Italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  // Links leave for a tab of their own, so a reply cannot navigate the panel.
  assert.deepEqual(link(element), {
    href: 'https://example.com',
    target: '_blank',
    rel: 'noopener noreferrer',
    text: 'Link',
  });
});

test('an ordered list keeps its numbering, with the nested items under each entry', async () => {
  const html = (await render([
    '1. **Hotel Alpha**\n   * Rating: 4.9\n   * Price: $200\n',
    '2. **Hotel Beta**\n   * Rating: 4.8\n',
    '3. **Hotel Gamma**\n   * Rating: 4.5\n',
  ])).innerHTML;

  assert.match(html, /<ol[^>]*>/);
  for (const hotel of ['Hotel Alpha', 'Hotel Beta', 'Hotel Gamma']) assert.ok(html.includes(hotel), html);
  assert.ok(html.includes('Rating: 4.9'), html);
  assert.equal((html.match(/<li>/g) ?? []).length, 7, html);
});

test('a construct split across chunks is held until it is whole', async () => {
  // Where a model's chunks land has nothing to do with where constructs end.
  const element = await render(['A **bo', 'ld** word and `co', 'de`, then [a li', 'nk](https://example.com/x).']);

  assert.match(element.innerHTML, /<strong>bold<\/strong>/);
  assert.match(element.innerHTML, /<code>code<\/code>/);
  assert.equal(link(element).href, 'https://example.com/x');
  assert.equal(link(element).text, 'a link');
});

test('text already on screen is appended to, not rendered again', async () => {
  const element = host();
  const stream = createMarkdownStream(element);

  stream.write('The first sentence. ');
  await settle();
  const paragraph = element.firstElementChild;
  const text = paragraph?.firstChild;

  stream.write('And the second one.');
  stream.end();
  await settle();

  // The same nodes are still there: the reply grew, nothing was replaced.
  assert.equal(element.firstElementChild, paragraph);
  assert.equal(paragraph?.firstChild, text);
  assert.ok(element.textContent?.includes('And the second one.'), element.innerHTML);
});

test('a link a model invents with an unsafe scheme is reported and dropped', async () => {
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  try {
    const html = (await render(['[Click me](javascript:alert(1))'])).innerHTML;
    assert.ok(!html.includes('javascript:'), html);
    assert.ok(html.includes('Click me'), html);
  } finally {
    console.warn = warn;
  }

  assert.equal(warnings.length, 1, JSON.stringify(warnings));
  // Markdown ends the URL at the first `)`, so that is what was dropped.
  assert.match(String(warnings[0]), /javascript:alert\(1/);
});

test('ending the stream closes what the last chunk left open', async () => {
  const element = host();
  const stream = createMarkdownStream(element);

  stream.write('A reply that stops mid');
  await settle();
  // The last character is held back: it could still turn out to be a marker.
  assert.ok(element.textContent?.includes('A reply that stops mi'), element.innerHTML);

  stream.end();
  await settle();
  assert.match(element.innerHTML, /^<p>A reply that stops mid<\/p>$/);
});
