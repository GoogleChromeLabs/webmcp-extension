import React from 'react';

/**
 * MarkdownText Component
 * Lightweight Markdown renderer for AI assistant responses.
 * Renders headers, lists, code blocks, inline code, bold, italics, and links.
 */
export function MarkdownText({ content = '', className = '' }) {
  if (!content) return null;

  const blocks = parseBlocks(content);

  return (
    <div className={`nexus-markdown ${className}`}>
      {blocks.map((block, idx) => (
        <RenderBlock key={idx} block={block} />
      ))}
    </div>
  );
}

function parseBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let currentCodeBlock = null;
  let currentList = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block fence toggle ```
    if (line.trim().startsWith('```')) {
      if (currentCodeBlock) {
        blocks.push({ type: 'code', language: currentCodeBlock.lang, code: currentCodeBlock.lines.join('\n') });
        currentCodeBlock = null;
      } else {
        if (currentList) {
          blocks.push(currentList);
          currentList = null;
        }
        const lang = line.trim().slice(3).trim();
        currentCodeBlock = { lang, lines: [] };
      }
      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.lines.push(line);
      continue;
    }

    // List items (* or - or 1.)
    const ulMatch = line.match(/^[\s]*[*|-]\s+(.*)/);
    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);

    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    } else if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    } else {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
    }

    // Headings
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2) });
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3) });
    } else if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4) });
    } else if (line.trim() === '') {
      continue;
    } else {
      blocks.push({ type: 'p', text: line });
    }
  }

  if (currentCodeBlock) {
    blocks.push({ type: 'code', language: currentCodeBlock.lang, code: currentCodeBlock.lines.join('\n') });
  }
  if (currentList) {
    blocks.push(currentList);
  }

  return blocks;
}

function RenderBlock({ block }) {
  switch (block.type) {
    case 'h1':
      return <h1 className="md-h1">{renderInline(block.text)}</h1>;
    case 'h2':
      return <h2 className="md-h2">{renderInline(block.text)}</h2>;
    case 'h3':
      return <h3 className="md-h3">{renderInline(block.text)}</h3>;
    case 'code':
      return (
        <pre className="md-code-block">
          {block.language && <span className="md-code-lang">{block.language}</span>}
          <code>{block.code}</code>
        </pre>
      );
    case 'ul':
      return (
        <ul className="md-ul">
          {block.items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="md-ol">
          {block.items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case 'p':
    default:
      return <p className="md-p">{renderInline(block.text)}</p>;
  }
}

function renderInline(text) {
  if (!text) return null;

  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} className="md-inline-code">{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={idx} href={linkMatch[2]} target="_blank" rel="noreferrer" className="md-link">
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}

export default MarkdownText;
