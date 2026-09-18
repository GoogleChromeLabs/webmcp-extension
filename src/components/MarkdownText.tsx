/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';

export interface MarkdownTextProps {
  content?: string;
  className?: string;
}

type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start?: number; items: string[] };

/**
 * MarkdownText Component
 * Lightweight Markdown renderer for AI assistant responses.
 */
export function MarkdownText({ content = '', className = '' }: MarkdownTextProps) {
  const blocks = useMemo(() => (content ? parseBlocks(content) : []), [content]);

  if (!content) return null;

  return (
    <div className={`markdown ${className}`}>
      {blocks.map((block, idx) => (
        <RenderBlock key={`${block.type}-${idx}`} block={block} />
      ))}
    </div>
  );
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let currentCodeBlock: { lang: string; lines: string[] } | null = null;
  let currentList: { type: 'ul' | 'ol'; start?: number; items: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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

    const ulMatch = line.match(/^[\s]*[*|-]\s+(.*)/);
    const olMatch = line.match(/^[\s]*(\d+)\.\s+(.*)/);

    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    } else if (olMatch) {
      const num = parseInt(olMatch[1], 10);
      const itemText = olMatch[2];
      if (!currentList || currentList.type !== 'ol') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ol', start: num, items: [itemText] };
      } else {
        currentList.items.push(itemText);
      }
      continue;
    } else {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
    }

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

function RenderBlock({ block }: { block: Block }) {
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
        <ol className="md-ol" start={block.start}>
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

function renderInline(text: string) {
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
      const href = linkMatch[2].trim();
      const isSafe = /^https?:\/\//i.test(href) || href.startsWith('/') || href.startsWith('#');
      return (
        <a
          key={idx}
          href={isSafe ? href : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}

export default MarkdownText;
