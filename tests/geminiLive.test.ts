/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { DEFAULT_LIVE_MODEL } from '../server/providers.js';
import {
  MIC_SAMPLE_RATE,
  PLAYBACK_SAMPLE_RATE,
  StreamResampler,
  base64ToBytes,
  bytesLEToInt16,
  bytesToBase64,
  decodeModelAudio,
  encodeMicChunk,
  floatTo16BitPCM,
  int16ToBytesLE,
  pcm16ToFloat,
  rms,
} from '../src/services/pcmAudio.js';
import {
  LIVE_MODEL_DEFAULT,
  LIVE_MODEL_ID_DEFAULT,
  TranscriptAccumulator,
  audioInput,
  buildFunctionDeclarations,
  buildSetup,
  clientTurn,
  parseServerMessage,
  textInput,
  toGeminiSchema,
  toolResponse,
} from '../src/services/geminiLive.js';
import { ButtonUI } from '../src/components/ButtonUI.js';
import { Toolbar } from '../src/components/Toolbar.js';
import { VoiceActiveBar } from '../src/components/VoiceActiveBar.js';
import { ChatBubble } from '../src/components/ChatBubble.js';

test('PROVIDERS.google defines defaultLiveModel as gemini-3.8-live', () => {
  assert.equal(DEFAULT_LIVE_MODEL, 'gemini-3.8-live');
  assert.equal(LIVE_MODEL_ID_DEFAULT, 'gemini-3.8-live');
});

test('pcmAudio - 16-bit PCM conversion, base64 encoding, and StreamResampler preserve signal integrity', () => {
  const input = new Float32Array([-1.5, -1, -0.5, 0, 0.5, 1, 1.5]);
  const pcm16 = floatTo16BitPCM(input);
  assert.equal(pcm16[0], -32768);
  assert.equal(pcm16[1], -32768);
  assert.equal(pcm16[3], 0);
  assert.equal(pcm16[5], 32767);
  assert.equal(pcm16[6], 32767);

  const bytes = int16ToBytesLE(pcm16);
  const b64 = bytesToBase64(bytes);
  const unpacked = bytesLEToInt16(base64ToBytes(b64));
  assert.deepEqual(Array.from(unpacked), Array.from(pcm16));

  const floatOut = pcm16ToFloat(unpacked);
  assert.ok(Math.abs(floatOut[4] - 0.5) < 0.001);

  // Downsample 48kHz -> 16kHz (3:1 ratio) across two 240-sample chunks
  const resampler = new StreamResampler(48000, MIC_SAMPLE_RATE);
  const chunk1 = new Float32Array(240).fill(0.25);
  const chunk2 = new Float32Array(240).fill(0.25);
  const enc1 = encodeMicChunk(chunk1, resampler);
  const enc2 = encodeMicChunk(chunk2, resampler);
  assert.equal(enc1.mimeType, 'audio/pcm;rate=16000');
  assert.equal(enc1.sampleCount + enc2.sampleCount, 160);

  const decoded = decodeModelAudio(enc1.base64, `audio/pcm;rate=${PLAYBACK_SAMPLE_RATE}`);
  assert.equal(decoded.sampleRate, PLAYBACK_SAMPLE_RATE);
  assert.ok(rms(decoded.samples) > 0.2);
});

test('geminiLive - buildSetup configures gemini-3.8-live, audio modalities, transcription, and WebMCP tools', () => {
  assert.equal(LIVE_MODEL_ID_DEFAULT, 'gemini-3.8-live');
  assert.equal(LIVE_MODEL_DEFAULT, 'models/gemini-3.8-live');
  assert.deepEqual(toGeminiSchema(null), { type: 'OBJECT', properties: {} });

  const decls = buildFunctionDeclarations([
    {
      name: 'search_flights',
      description: 'Search flights on page',
      frameId: 0,
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'IATA code' },
        },
        required: ['origin'],
        additionalProperties: false,
      },
    },
  ]);

  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, '_0_search_flights');
  assert.deepEqual(decls[0].parameters, {
    type: 'OBJECT',
    properties: {
      origin: { type: 'STRING', description: 'IATA code' },
    },
    required: ['origin'],
  });

  const setupFrame = buildSetup({
    systemInstruction: 'You are a WebMCP voice agent.',
    tools: decls,
    resumeHandle: 'resume-xyz',
  }) as { setup: Record<string, unknown> };

  assert.equal(setupFrame.setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(setupFrame.setup.inputAudioTranscription, {});
  assert.deepEqual(setupFrame.setup.outputAudioTranscription, {});
  assert.deepEqual(setupFrame.setup.sessionResumption, { handle: 'resume-xyz' });
  assert.deepEqual(setupFrame.setup.realtimeInputConfig, {
    automaticActivityDetection: {
      disabled: false,
      silenceDurationMs: 2000,
      prefixPaddingMs: 500,
    },
    turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY',
  });

  // Verify realtimeInput.audio format (no deprecated mediaChunks)
  const audioFrame = audioInput('AAAA') as { realtimeInput: Record<string, unknown> };
  assert.deepEqual(audioFrame.realtimeInput, {
    audio: {
      data: 'AAAA',
      mimeType: 'audio/pcm;rate=16000',
    },
  });
  assert.equal('mediaChunks' in audioFrame.realtimeInput, false);

  assert.deepEqual(textInput('hello'), { realtimeInput: { text: 'hello' } });
  assert.deepEqual(clientTurn([{ role: 'user', text: 'prior context' }], false), {
    clientContent: {
      turns: [{ role: 'user', parts: [{ text: 'prior context' }] }],
      turnComplete: false,
    },
  });
  assert.deepEqual(
    toolResponse([{ id: 'call_1', name: '_0_search_flights', response: { result: 'ok' } }]),
    {
      toolResponse: {
        functionResponses: [
          { id: 'call_1', name: '_0_search_flights', response: { result: 'ok' } },
        ],
      },
    }
  );
});

test('geminiLive - fetchLiveCredentials mints ephemeral token directly in the extension without a server', async () => {
  const { fetchLiveCredentials } = await import('../src/services/geminiLive.js');
  const prevEnvKey = process.env.WEBMCP_GEMINI_API_KEY;
  process.env.WEBMCP_GEMINI_API_KEY = 'ext-direct-key';
  try {
    const creds = await fetchLiveCredentials((async (url: string) => {
      assert.ok(String(url).endsWith('/v1beta/auth_tokens'));
      return {
        ok: true,
        json: async () => ({ name: 'auth_tokens/serverless-ephemeral-1' }),
      };
    }) as unknown as typeof fetch);

    assert.equal(creds.authMode, 'ephemeral');
    assert.equal(creds.token, 'auth_tokens/serverless-ephemeral-1');
    assert.equal(creds.model, 'gemini-3.8-live');
    assert.equal(creds.modelResource, 'models/gemini-3.8-live');
    assert.ok(
      creds.wsUrl.includes(
        'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fserverless-ephemeral-1'
      )
    );
  } finally {
    if (prevEnvKey === undefined) delete process.env.WEBMCP_GEMINI_API_KEY;
    else process.env.WEBMCP_GEMINI_API_KEY = prevEnvKey;
  }
});

test('geminiLive - parseServerMessage and TranscriptAccumulator handle multi-field frames and tool calls', () => {
  const rawFrame = {
    serverContent: {
      inputTranscription: { text: 'Filter by', finished: false },
      outputTranscription: { text: 'Applying filter', finished: false },
      modelTurn: {
        parts: [
          { thought: true, text: 'Internal reasoning' },
          { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'BBBB' } },
        ],
      },
      turnComplete: true,
    },
    toolCall: {
      functionCalls: [{ id: 'fc_1', name: '_0_apply_filter', args: { category: 'shoes' } }],
    },
  };

  const events = parseServerMessage(rawFrame);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['inputTranscript', 'outputTranscript', 'audio', 'turnComplete', 'toolCall']
  );

  const committed: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  const interims: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  const acc = new TranscriptAccumulator(
    (turn) => committed.push(turn),
    (turn) => interims.push(turn)
  );

  acc.feed({ kind: 'inputTranscript', text: 'Book', finished: false });
  acc.feed({ kind: 'inputTranscript', text: 'this hotel', finished: true });
  acc.feed({ kind: 'outputTranscript', text: 'Booking', finished: false });
  acc.feed({ kind: 'outputTranscript', text: 'right now.', finished: false });
  acc.feed({ kind: 'turnComplete' });

  assert.deepEqual(committed, [
    { role: 'user', text: 'Book this hotel' },
    { role: 'assistant', text: 'Booking right now.' },
  ]);
  assert.ok(interims.length >= 3);
});

test('Voice UI components - ButtonUI, Toolbar, VoiceActiveBar, and ChatBubble render voice controls', () => {
  const liveBtnHtml = renderToString(React.createElement(ButtonUI, { variant: 'live', pressed: true }));
  assert.ok(liveBtnHtml.includes('button-ui--live'));
  assert.ok(liveBtnHtml.includes('button-ui--pressed'));

  const toolbarLiveHtml = renderToString(
    React.createElement(Toolbar, {
      actionVariant: 'live',
      voiceActive: true,
      onSettingsClick: () => {},
    })
  );
  assert.ok(toolbarLiveHtml.includes('button-ui--pressed'));
  assert.ok(toolbarLiveHtml.includes('Stop voice mode'));

  const voiceBarHtml = renderToString(
    React.createElement(VoiceActiveBar, {
      status: 'speaking',
      muted: false,
      level: 0.5,
      model: 'gemini-3.8-live',
      onInterrupt: () => {},
      onToggleMute: () => {},
      onStop: () => {},
    })
  );
  assert.ok(voiceBarHtml.includes('voice-active-bar--speaking'));
  assert.ok(voiceBarHtml.includes('Agent responding…'));
  assert.ok(voiceBarHtml.includes('Interrupt'));
  assert.ok(voiceBarHtml.includes('Mute microphone'));
  assert.ok(voiceBarHtml.includes('End voice mode'));

  const bubbleHtml = renderToString(
    React.createElement(ChatBubble, {
      showTab: true,
      tabProps: { domain: 'store.example.com', hasTools: true, toolsCountLabel: '4 tools' },
      voiceProps: {
        status: 'listening',
        interimText: 'add blue sneakers to cart',
        onToggleMute: () => {},
        onStop: () => {},
      },
    })
  );
  assert.ok(bubbleHtml.includes('chat-bubble--voice-active'));
  assert.ok(bubbleHtml.includes('Listening: &quot;add blue sneakers to cart&quot;'));
});

test('pcmAudio - requestExtensionMicrophonePermission creates permission tab and awaits result', async () => {
  const { requestExtensionMicrophonePermission } = await import('../src/services/pcmAudio.js');
  let tabCreatedUrl = '';
  let messageListener: ((msg: any) => void) | null = null;

  (globalThis as any).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test-ext-id/${path}`,
      addListener: (cb: any) => { messageListener = cb; },
      onMessage: {
        addListener: (cb: any) => { messageListener = cb; },
        removeListener: () => { messageListener = null; },
      },
    },
    tabs: {
      create: (opts: { url: string }, cb?: () => void) => {
        tabCreatedUrl = opts.url;
        cb?.();
        // Simulate user clicking Allow in permission.html
        setTimeout(() => {
          messageListener?.({ type: 'WEBMCP_MIC_PERMISSION_RESULT', granted: true });
        }, 10);
      },
    },
  };

  try {
    const granted = await requestExtensionMicrophonePermission();
    assert.equal(granted, true);
    assert.equal(tabCreatedUrl, 'chrome-extension://test-ext-id/permission.html');
  } finally {
    delete (globalThis as any).chrome;
  }
});

