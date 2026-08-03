/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProvidersMap } from './types/index.js';

export const PROVIDERS: ProvidersMap = {
  gemini: {
    label: 'Gemini',
    models: ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'],
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5-mini', 'gpt-4.1'],
  },
  anthropic: {
    label: 'Anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
};

export default PROVIDERS;
