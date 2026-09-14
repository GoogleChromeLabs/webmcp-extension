/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal declarations for the parts of the Prompt API this extension uses.
 * See https://developer.mozilla.org/docs/Web/API/Prompt_API
 */

export {};

declare global {
  type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

  interface LanguageModelExpected {
    type: 'text' | 'image' | 'audio' | 'tool-call' | 'tool-response';
    languages?: string[];
  }

  interface LanguageModelToolDeclaration {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }

  interface LanguageModelToolCall {
    callID: string;
    name: string;
    arguments: Record<string, unknown>;
  }

  /**
   * - "text": a string
   * - "image": an ImageBitmapSource or a BufferSource
   * - "audio": an AudioBuffer, an HTMLAudioElement, or a BufferSource
   * - "object": a JSON-serializable value
   */
  type LanguageModelToolResultType = 'text' | 'image' | 'audio' | 'object';

  interface LanguageModelToolResultItem {
    type: LanguageModelToolResultType;
    value: unknown;
  }

  interface LanguageModelToolSuccessInit {
    callID: string;
    name: string;
    result: LanguageModelToolResultItem[];
  }

  interface LanguageModelToolErrorInit {
    callID: string;
    name: string;
    errorMessage: string;
  }

  const LanguageModelToolSuccess: {
    new (init: LanguageModelToolSuccessInit): object;
  };

  const LanguageModelToolError: {
    new (init: LanguageModelToolErrorInit): object;
  };

  interface LanguageModelMessageContent {
    type: 'text' | 'image' | 'audio' | 'tool-call' | 'tool-response';
    value: unknown;
  }

  interface LanguageModelMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | LanguageModelMessageContent[];
  }

  interface LanguageModelCreateCoreOptions {
    expectedInputs?: LanguageModelExpected[];
    expectedOutputs?: LanguageModelExpected[];
    tools?: LanguageModelToolDeclaration[];
  }

  interface LanguageModelCreateOptions extends LanguageModelCreateCoreOptions {
    initialPrompts?: LanguageModelMessage[];
    monitor?: (monitor: EventTarget) => void;
    signal?: AbortSignal;
  }

  interface LanguageModelSession {
    prompt(input: string | LanguageModelMessage[], options?: { signal?: AbortSignal }): Promise<string>;
    // Async iterable as well as a stream, which is how it is read below.
    promptStreaming(
      input: string | LanguageModelMessage[],
      options?: { signal?: AbortSignal }
    ): AsyncIterable<string | { type: string; value: LanguageModelToolCall }>;
    destroy(): void;
  }

  const LanguageModel: {
    availability(options?: LanguageModelCreateCoreOptions): Promise<LanguageModelAvailability>;
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  };
}
