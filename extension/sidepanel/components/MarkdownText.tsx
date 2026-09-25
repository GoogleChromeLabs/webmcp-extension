/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { createHtmlTokenStreamer, renderStreamingHTML } from 'streaming-markdown-html';

export interface MarkdownTextProps {
  content?: string;
  /**
   * Whether more of this text is still on its way. A reply that is finished is
   * flushed, which closes the constructs the last chunk left open.
   */
  streaming?: boolean;
}

/**
 * What one mounted element is showing, and what is still holding it open.
 *
 * The parser is append-only: it is told what is new and emits the HTML for it,
 * and what it emitted before is never revisited. So the element keeps its
 * parser between renders, and a render only hands over the characters that
 * arrived since the last one.
 */
export interface MarkdownStream {
  /** The element being written into, which a remount replaces. */
  element: HTMLElement;
  /** Everything written so far, to tell a longer reply from a different one. */
  written: string;
  write(markdown: string): void;
  /** Closes what the Markdown left open. Nothing may be written after it. */
  end(): void;
  ended: boolean;
}

/**
 * Sends the links in a reply to a tab of their own. The side panel is the
 * whole UI, so a link that followed in place would navigate the conversation
 * away, and `rel` keeps the opened page from reaching back through `opener`.
 */
function openLinksInATabOfTheirOwn(element: HTMLElement): void {
  for (const link of element.querySelectorAll('a[href]:not([target])')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
}

/** Exported for the tests, which drive it without React. */
export function createMarkdownStream(element: HTMLElement): MarkdownStream {
  // Chunks are single tokens, which the sink turns into nodes with
  // createElement and append: no HTML string is ever parsed.
  const writer = renderStreamingHTML(element).getWriter();
  const ignore = () => {};
  const streamer = createHtmlTokenStreamer({
    onHtml: (html) =>
      void writer
        .write(html)
        .then(() => {
          // An anchor arrives complete, with its href, so it is ready to mark
          // as soon as the sink has appended it.
          if (html.startsWith('<a ')) openLinksInATabOfTheirOwn(element);
        })
        .catch(ignore),
    onUnsafe: ({ attribute, value }) =>
      console.warn(`[WebMCP] A model's reply linked to ${value}, which was dropped from ${attribute}.`),
  });

  const stream: MarkdownStream = {
    element,
    written: '',
    ended: false,
    write(markdown) {
      if (!markdown) return;
      streamer.write(markdown);
      stream.written += markdown;
    },
    end() {
      if (stream.ended) return;
      stream.ended = true;
      streamer.end();
      void writer.close().catch(ignore);
    },
  };
  return stream;
}

/**
 * MarkdownText Component
 * Renders a model's Markdown as it arrives.
 *
 * The text grows a few characters at a time, so it is streamed into the DOM
 * rather than parsed again on every chunk: what is already on screen stays as
 * it is and only the new words are appended. React owns the element and
 * nothing else, which is why the children are built by hand here.
 */
export function MarkdownText({ content = '', streaming = false }: MarkdownTextProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MarkdownStream | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let stream = streamRef.current;

    // A reply that no longer starts with what was rendered is a different one,
    // and so is more text after the last one was closed, or an element put
    // back after the text was empty for a render. None of those can be reached
    // by appending, so the parser starts over on an empty element.
    if (!stream || stream.ended || stream.element !== element || !content.startsWith(stream.written)) {
      stream?.end();
      element.replaceChildren();
      stream = streamRef.current = createMarkdownStream(element);
    }

    stream.write(content.slice(stream.written.length));
    if (!streaming) stream.end();
  }, [content, streaming]);

  useEffect(() => {
    return () => {
      streamRef.current?.end();
      streamRef.current = null;
    };
  }, []);

  if (!content) return null;

  return <div className="markdown" ref={elementRef} />;
}
