/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeModel, loadProviders, parseModelSpec } from '../server/providers.js';

/**
 * Every name the loader looks for. A key left in the developer's own shell
 * would otherwise decide the outcome of these tests, so they are all cleared
 * for the duration of one.
 */
const ENV_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'API_KEY',
  'apiKey',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_BASE_URL',
  'OPENAI_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'OLLAMA_HOST',
  'MODEL',
  'model',
];

/** Loads a configuration from `env` alone, with the shell out of the picture. */
function load(env: Record<string, string>) {
  const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  try {
    return loadProviders(env);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** The problem a configuration reports, which these tests expect there to be. */
function problemOf(config: { problem: string | null }) {
  assert.ok(config.problem, 'a problem to report');
  return String(config.problem);
}

/**
 * The URL a configuration's model actually calls.
 *
 * Where a request goes is the only honest way to check the two things that are
 * easy to get wrong and invisible from the outside: which OpenAI API is in use,
 * and whether a base URL override took effect. The reply is deliberately
 * nonsense — the request has already been made by the time it matters.
 */
async function requestUrlOf(config: ReturnType<typeof load>) {
  const model = config.model;
  assert.ok(model, 'a model to answer with');

  let url = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    url = String(input instanceof Request ? input.url : input);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
  } catch {
    // An empty reply is not a valid completion. The URL is what is being read.
  } finally {
    globalThis.fetch = realFetch;
  }

  return url;
}

test('parseModelSpec splits provider from model, and reads a bare name as Google', () => {
  assert.deepEqual(parseModelSpec('openai:gpt-4o'), { providerId: 'openai', modelId: 'gpt-4o' });
  assert.deepEqual(parseModelSpec('anthropic:claude-sonnet-4-5'), {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
  });
  // An .env written before there was a choice keeps working.
  assert.deepEqual(parseModelSpec('gemini-3.6-flash'), { providerId: 'google', modelId: 'gemini-3.6-flash' });
  assert.deepEqual(parseModelSpec('  openai:gpt-4o  '), { providerId: 'openai', modelId: 'gpt-4o' });
  assert.deepEqual(parseModelSpec('OPENAI : gpt-4o'), { providerId: 'openai', modelId: 'gpt-4o' });
  // Only the first colon separates: a fine-tuned OpenAI model has its own.
  assert.deepEqual(parseModelSpec('openai:ft:gpt-4o:acme:1'), { providerId: 'openai', modelId: 'ft:gpt-4o:acme:1' });
});

test('parseModelSpec refuses what it cannot use', () => {
  // A provider nobody here can talk to, and a prefix with nothing after it.
  assert.equal(parseModelSpec('llama:7b'), null);
  assert.equal(parseModelSpec('openai:'), null);
  assert.equal(parseModelSpec(''), null);
  assert.equal(parseModelSpec('   '), null);
  assert.equal(parseModelSpec(undefined), null);
  assert.equal(parseModelSpec(42), null);
});

test('loadProviders registers only the providers that have a key', () => {
  const config = load({ OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test', MODEL: 'openai:gpt-4o' });

  assert.deepEqual(config.configured, ['google', 'openai']);
  assert.deepEqual(config.spec, { providerId: 'openai', modelId: 'gpt-4o' });
  assert.equal(config.problem, null);
  assert.equal(describeModel(config), 'openai:gpt-4o');
  assert.ok(config.model, 'a model to answer with');
});

test('loadProviders falls back to Gemini when .env names no model, or auto-selects the configured provider', () => {
  const config = load({ GEMINI_API_KEY: 'g-test' });

  assert.equal(config.problem, null);
  assert.equal(describeModel(config), 'google:gemini-3.6-flash');

  // When only OPENAI_API_KEY or ANTHROPIC_API_KEY is set without MODEL, it works out of the box
  const openaiOnly = load({ OPENAI_API_KEY: 'sk-test' });
  assert.equal(openaiOnly.problem, null);
  assert.equal(describeModel(openaiOnly), 'openai:gpt-4o');

  const anthropicOnly = load({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  assert.equal(anthropicOnly.problem, null);
  assert.equal(describeModel(anthropicOnly), 'anthropic:claude-sonnet-4-5');
});

test('loadProviders still reads the older key names', () => {
  // These are what .env files in the wild already say.
  assert.deepEqual(load({ API_KEY: 'g-test' }).configured, ['google']);
  assert.deepEqual(load({ apiKey: 'g-test' }).configured, ['google']);
  assert.deepEqual(load({ GOOGLE_GENERATIVE_AI_API_KEY: 'g-test' }).configured, ['google']);
});

test('loadProviders says what is wrong instead of failing later', () => {
  // Nothing set up at all.
  const none = load({});
  assert.match(problemOf(none), /No model API key found/);
  assert.match(problemOf(none), /GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY/);
  assert.equal(none.model, null);

  // A key, but a MODEL naming a provider nobody here can talk to. Note that a
  // name with no prefix cannot be caught this way: it is read as Google's, and
  // there is no catalogue to check it against, so a typo in a bare model name
  // only shows up as an error from Google.
  const unparsable = load({ GEMINI_API_KEY: 'g-test', MODEL: 'llama:7b' });
  assert.match(problemOf(unparsable), /is not understood/);
  assert.match(problemOf(unparsable), /openai:gpt-4o/);
  assert.equal(unparsable.model, null);
  // What was asked for is still reported, so the log names the wrong value.
  assert.equal(describeModel(unparsable), 'llama:7b');

  // The right shape, but the key for that provider is missing. This is the
  // mistake worth catching: it would otherwise be a 401 mid-conversation.
  const missingKey = load({ GEMINI_API_KEY: 'g-test', MODEL: 'openai:gpt-4o' });
  assert.match(problemOf(missingKey), /OPENAI_API_KEY is not set/);
  assert.match(problemOf(missingKey), /configured: google/);
  assert.equal(missingKey.model, null);
});

test('OpenAI talks chat completions, not the Responses API', async () => {
  // The SDK would otherwise default to /responses, which only OpenAI itself
  // implements. Chat completions is what every OpenAI-compatible server
  // speaks, so it is the only choice that makes OPENAI_BASE_URL useful.
  const url = await requestUrlOf(load({ OPENAI_API_KEY: 'sk-test', MODEL: 'openai:gpt-4o' }));

  assert.match(url, /\/chat\/completions$/);
  assert.doesNotMatch(url, /\/responses$/);
});

test('a base URL sends the request somewhere else', async () => {
  const openai = await requestUrlOf(
    load({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: 'http://localhost:4000/v1', MODEL: 'openai:gpt-4o' }),
  );
  assert.equal(openai, 'http://localhost:4000/v1/chat/completions');

  const anthropic = await requestUrlOf(
    load({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'http://localhost:4000/anthropic',
      MODEL: 'anthropic:claude-sonnet-4-5',
    }),
  );
  assert.match(anthropic, /^http:\/\/localhost:4000\/anthropic\//);

  const google = await requestUrlOf(
    load({
      GEMINI_API_KEY: 'g-test',
      GOOGLE_GENERATIVE_AI_BASE_URL: 'http://localhost:4000/google',
      MODEL: 'google:gemini-3.6-flash',
    }),
  );
  assert.match(google, /^http:\/\/localhost:4000\/google\//);
});

test('Ollama runs locally without a key', async () => {
  const config = load({ MODEL: 'ollama:llama3.2' });

  // Nothing else is set up, and that is fine: a local runtime needs no key.
  assert.deepEqual(config.configured, ['ollama']);
  assert.equal(config.problem, null);
  assert.equal(describeModel(config), 'ollama:llama3.2');
  assert.equal(await requestUrlOf(config), 'http://127.0.0.1:11434/v1/chat/completions');

  // And it can be moved, for a runtime on another machine.
  const elsewhere = load({ MODEL: 'ollama:llama3.2', OLLAMA_HOST: 'http://gpu-box:11434/v1' });
  assert.equal(await requestUrlOf(elsewhere), 'http://gpu-box:11434/v1/chat/completions');

  // Standard OLLAMA_HOST without /v1 is normalized to include /v1 automatically
  const standardHost = load({ MODEL: 'ollama:llama3.2', OLLAMA_HOST: 'http://gpu-box:11434' });
  assert.equal(await requestUrlOf(standardHost), 'http://gpu-box:11434/v1/chat/completions');

  const bareHost = load({ MODEL: 'ollama:llama3.2', OLLAMA_HOST: 'gpu-box:11434' });
  assert.equal(await requestUrlOf(bareHost), 'http://gpu-box:11434/v1/chat/completions');
});

test('Ollama does not count as configured unless MODEL asks for it', () => {
  // Otherwise an .env with no keys at all would look healthy at startup and
  // only fail on the first turn, against a server nobody has started.
  const none = load({});
  assert.deepEqual(none.configured, []);
  assert.match(problemOf(none), /No model API key found/);

  // It also stays out of the way of a provider that is properly set up.
  const google = load({ GEMINI_API_KEY: 'g-test' });
  assert.deepEqual(google.configured, ['google']);
});
