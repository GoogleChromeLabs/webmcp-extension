/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import { getEnv, type DotEnv } from './security.ts';

const IMPLIED_PROVIDER = 'google';

interface ProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

/** What every provider hands back: a model instance, never a gateway id string. */
export type ChatModel = Exclude<LanguageModel, string>;

interface ProviderSpec {
  /** Env names of the API key, in order of preference. */
  keys: string[];
  /** Env name of an optional base URL override. */
  baseUrl: string;
  /** Model used when `MODEL` is unset. */
  defaultModel?: string;
  open: (options: ProviderOptions) => (modelId: string) => ChatModel;
}

function normalizeOllamaUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return 'http://127.0.0.1:11434/v1';
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return /\/v1$/i.test(url) ? url : `${url}/v1`;
}

const GOOGLE_DEFAULT_MODEL = 'google:gemini-3.6-flash';

const PROVIDERS: Record<string, ProviderSpec> = {
  google: {
    keys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    baseUrl: 'GOOGLE_GENERATIVE_AI_BASE_URL',
    defaultModel: GOOGLE_DEFAULT_MODEL,
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

/**
 * @returns The first of `names` that is set.
 */
function readEnv(env: DotEnv, names: string[]): string | null {
  for (const name of names) {
    const value = getEnv(env, name);
    if (value) return value;
  }
  return null;
}

export interface ModelSpec {
  providerId: string;
  modelId: string;
}

/**
 * Splits `openai:gpt-4o` into `{ providerId, modelId }`. A bare model name
 * defaults to `google` so older `.env` files continue to work.
 */
export function parseModelSpec(spec: unknown): ModelSpec | null {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  const trimmed = spec.trim();
  const separator = trimmed.indexOf(':');
  const providerId =
    separator === -1 ? IMPLIED_PROVIDER : trimmed.slice(0, separator).trim().toLowerCase();
  const modelId = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();

  if (!modelId || !Object.hasOwn(PROVIDERS, providerId)) return null;
  return { providerId, modelId };
}

export interface ProviderConfig {
  /** Providers that have what they need to run. */
  configured: string[];
  /** The `MODEL` value, or the default. */
  requestedSpec: string;
  spec: ModelSpec | null;
  /** Why no model could be made, if so. */
  problem: string | null;
  model: ChatModel | null;
}

/**
 * Reads provider credentials and model choice from `env` / `process.env`
 * and instantiates the active language model.
 *
 * @param env Values loaded from `.env`.
 */
export function loadProviders(env: DotEnv = {}): ProviderConfig {
  const configured = Object.entries(PROVIDERS)
    .filter(([, p]) => readEnv(env, p.keys))
    .map(([id]) => id);

  const defaultSpec = PROVIDERS[configured[0]]?.defaultModel ?? GOOGLE_DEFAULT_MODEL;

  const requested = getEnv(env, 'MODEL') || defaultSpec;
  const parsed = parseModelSpec(requested);

  if (parsed && PROVIDERS[parsed.providerId]?.keys.length === 0 && !configured.includes(parsed.providerId)) {
    configured.push(parsed.providerId);
  }

  let problem: string | null = null;
  if (!parsed) {
    problem = `MODEL="${requested}" is not understood. Use provider:model, such as openai:gpt-4o, anthropic:claude-sonnet-4-5, google:gemini-3.6-flash or ollama:llama3.2 (known providers: ${Object.keys(PROVIDERS).join(', ')})`;
  } else if (configured.length === 0) {
    problem = 'No model API key found. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in .env, or use MODEL=ollama:<model> to run locally';
  } else if (!configured.includes(parsed.providerId)) {
    const keyName = PROVIDERS[parsed.providerId].keys[0];
    problem = `MODEL asks for "${parsed.providerId}" but ${keyName} is not set in .env (configured: ${configured.join(', ')})`;
  }

  let model: ChatModel | null = null;
  if (!problem && parsed) {
    const provider = PROVIDERS[parsed.providerId];
    const apiKey = readEnv(env, provider.keys);
    const baseURL = getEnv(env, provider.baseUrl) || undefined;
    model = provider.open({ apiKey: apiKey ?? undefined, baseURL })(parsed.modelId);
  }

  return {
    configured,
    requestedSpec: requested,
    spec: parsed,
    problem,
    model,
  };
}

/**
 * @returns The model in `provider:model` form.
 */
export function describeModel(config: ProviderConfig): string {
  return config.spec ? `${config.spec.providerId}:${config.spec.modelId}` : config.requestedSpec;
}
