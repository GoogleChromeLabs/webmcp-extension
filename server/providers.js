/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

import { getEnv } from './security.js';

const IMPLIED_PROVIDER = 'google';

function normalizeOllamaUrl(rawUrl) {
  if (!rawUrl) return 'http://127.0.0.1:11434/v1';
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return /\/v1$/i.test(url) ? url : `${url}/v1`;
}

const PROVIDERS = {
  google: {
    keys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    baseUrl: 'GOOGLE_GENERATIVE_AI_BASE_URL',
    defaultModel: 'google:gemini-3.6-flash',
    open: (options) => createGoogleGenerativeAI(options),
  },
  openai: {
    keys: ['OPENAI_API_KEY'],
    baseUrl: 'OPENAI_BASE_URL',
    defaultModel: 'openai:gpt-4o',
    open: (options) => createOpenAI(options).chat,
  },
  anthropic: {
    keys: ['ANTHROPIC_API_KEY'],
    baseUrl: 'ANTHROPIC_BASE_URL',
    defaultModel: 'anthropic:claude-sonnet-4-5',
    open: (options) => createAnthropic(options),
  },
  ollama: {
    keys: [],
    baseUrl: 'OLLAMA_HOST',
    open: (options) =>
      createOpenAI({ ...options, apiKey: 'ollama', baseURL: normalizeOllamaUrl(options.baseURL) }).chat,
  },
};

function readEnv(env, names) {
  for (const name of names) {
    const value = getEnv(env, name);
    if (value) return value;
  }
  return null;
}

/**
 * Splits `openai:gpt-4o` into `{ providerId, modelId }`. A bare model name
 * defaults to `google` so older `.env` files continue to work.
 */
export function parseModelSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  const trimmed = spec.trim();
  const separator = trimmed.indexOf(':');
  const providerId =
    separator === -1 ? IMPLIED_PROVIDER : trimmed.slice(0, separator).trim().toLowerCase();
  const modelId = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();

  if (!modelId || !Object.hasOwn(PROVIDERS, providerId)) return null;
  return { providerId, modelId };
}

/**
 * Reads provider credentials and model choice from `env` / `process.env`
 * and instantiates the active language model.
 */
export function loadProviders(env = {}) {
  const configured = Object.entries(PROVIDERS)
    .filter(([, p]) => readEnv(env, p.keys))
    .map(([id]) => id);

  const defaultSpec = PROVIDERS[configured[0]]?.defaultModel ?? PROVIDERS.google.defaultModel;

  const requested = getEnv(env, 'MODEL') || defaultSpec;
  const parsed = parseModelSpec(requested);

  if (parsed && PROVIDERS[parsed.providerId]?.keys.length === 0 && !configured.includes(parsed.providerId)) {
    configured.push(parsed.providerId);
  }

  let problem = null;
  if (!parsed) {
    problem = `MODEL="${requested}" is not understood. Use provider:model, such as openai:gpt-4o, anthropic:claude-sonnet-4-5, google:gemini-3.6-flash or ollama:llama3.2 (known providers: ${Object.keys(PROVIDERS).join(', ')})`;
  } else if (configured.length === 0) {
    problem = 'No model API key found. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in .env, or use MODEL=ollama:<model> to run locally';
  } else if (!configured.includes(parsed.providerId)) {
    const keyName = PROVIDERS[parsed.providerId].keys[0];
    problem = `MODEL asks for "${parsed.providerId}" but ${keyName} is not set in .env (configured: ${configured.join(', ')})`;
  }

  let model = null;
  if (!problem && parsed) {
    const provider = PROVIDERS[parsed.providerId];
    const apiKey = readEnv(env, provider.keys);
    const baseURL = getEnv(env, provider.baseUrl) || undefined;
    model = provider.open({ apiKey, baseURL })(parsed.modelId);
  }

  return {
    configured,
    requestedSpec: requested,
    spec: parsed,
    problem,
    model,
  };
}

export function describeModel(config) {
  return config.spec ? `${config.spec.providerId}:${config.spec.modelId}` : config.requestedSpec;
}
