import test from 'node:test';
import assert from 'node:assert/strict';

// Markdown parser helper logic (matching MarkdownText.jsx)
function parseInline(text) {
  const parts = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push({ type: 'bold', content: token.slice(2, -2) });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push({ type: 'italic', content: token.slice(1, -1) });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push({ type: 'code', content: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch) {
        parts.push({ type: 'link', text: linkMatch[1], href: linkMatch[2] });
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  return parts;
}

test('parseInline parses bold, italic, code, and markdown links', () => {
  const text = 'Hello **world**, this is *italic*, `code` and [link](https://google.com)';
  const tokens = parseInline(text);

  assert.ok(tokens.some((t) => t.type === 'bold' && t.content === 'world'));
  assert.ok(tokens.some((t) => t.type === 'italic' && t.content === 'italic'));
  assert.ok(tokens.some((t) => t.type === 'code' && t.content === 'code'));
  assert.ok(tokens.some((t) => t.type === 'link' && t.text === 'link' && t.href === 'https://google.com'));
});
