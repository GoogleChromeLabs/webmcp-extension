/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Prompt API's tool call classes, which `@types/dom-chromium-ai` does not
 * declare yet. See https://github.com/webmachinelearning/prompt-api
 */

export {};

declare global {
  /**
   * The ID that pairs a call with its response. The Prompt API is renaming
   * `callID` to `callId`, so a browser may send or expect either one.
   */
  interface LanguageModelToolCallId {
    callId?: string;
    callID?: string;
  }

  interface LanguageModelToolCallInit extends LanguageModelToolCallId {
    name: string;
    arguments: Record<string, unknown>;
  }

  /**
   * - "text": a string
   * - "image": an ImageBitmapSource or a BufferSource
   * - "audio": an AudioBuffer, an HTMLAudioElement, or a BufferSource
   * - "object": a JSON-serializable value
   */
  interface LanguageModelToolResultItem {
    type: 'text' | 'image' | 'audio' | 'object';
    value: unknown;
  }

  const LanguageModelToolCall: {
    new (init: LanguageModelToolCallInit): LanguageModelToolCallInit;
  };

  const LanguageModelToolSuccess: {
    new (init: LanguageModelToolCallId & { name: string; result: LanguageModelToolResultItem[] }): object;
  };

  const LanguageModelToolError: {
    new (init: LanguageModelToolCallId & { name: string; errorMessage: string }): object;
  };
}
