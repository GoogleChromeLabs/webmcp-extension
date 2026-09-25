/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure 16kHz/24kHz 16-bit little-endian mono PCM audio utilities and
 * Web Audio AudioWorklet capture/playback engine for the Gemini Live API.
 *
 * Strictly uses real bidirectional PCM streaming over AudioWorklet — zero
 * browser TTS (`speechSynthesis`) or `SpeechRecognition` fallbacks.
 */

export const MIC_SAMPLE_RATE = 16000;
export const PLAYBACK_SAMPLE_RATE = 24000;

/**
 * Clamp and quantize Float32 audio samples in [-1, 1] to signed 16-bit PCM.
 */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    if (s !== s) {
      out[i] = 0;
    } else if (s >= 1) {
      out[i] = 0x7fff;
    } else if (s <= -1) {
      out[i] = -0x8000;
    } else {
      out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
    }
  }
  return out;
}

/**
 * Convert signed 16-bit PCM samples back to Float32 in [-1, 1].
 */
export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/**
 * Pack an Int16Array into a little-endian Uint8Array regardless of host endianness.
 */
export function int16ToBytesLE(samples: Int16Array): Uint8Array {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], true);
  }
  return new Uint8Array(buf);
}

/**
 * Unpack a little-endian Uint8Array into an Int16Array. Odd trailing bytes are dropped.
 */
export function bytesLEToInt16(bytes: Uint8Array): Int16Array {
  const count = bytes.byteLength >> 1;
  const out = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure base64 encoder for Uint8Array payloads.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63] +
      B64_CHARS[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63] +
      '=';
  }
  return out;
}

/**
 * Pure base64 decoder returning a Uint8Array.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.max(0, ((clean.length * 3) >> 2) - pad);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = Math.max(0, B64_CHARS.indexOf(clean[i]));
    const c1 = Math.max(0, B64_CHARS.indexOf(clean[i + 1]));
    const c2 = clean[i + 2] === '=' ? 0 : Math.max(0, B64_CHARS.indexOf(clean[i + 2]));
    const c3 = clean[i + 3] === '=' ? 0 : Math.max(0, B64_CHARS.indexOf(clean[i + 3]));
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLen) out[outIdx++] = (n >>> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (n >>> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = n & 0xff;
  }
  return out;
}

/**
 * Stateful linear resampler preserving sub-sample phase and boundary sample
 * across AudioWorklet blocks so downsampling 48kHz/44.1kHz -> 16kHz has zero
 * boundary clicks.
 */
export class StreamResampler {
  private readonly ratio: number;
  private phase = 0;
  private lastSample = 0;
  private primed = false;

  constructor(
    public readonly fromRate: number,
    public readonly toRate: number
  ) {
    if (fromRate <= 0 || toRate <= 0) {
      throw new RangeError(`Sample rates must be positive (got ${fromRate} -> ${toRate})`);
    }
    this.ratio = fromRate / toRate;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    if (this.ratio === 1) {
      this.lastSample = input[input.length - 1];
      this.primed = true;
      return input.slice();
    }

    if (!this.primed) {
      this.lastSample = input[0];
      this.primed = true;
    }

    const maxOut = Math.ceil((input.length - this.phase) / this.ratio) + 1;
    const out = new Float32Array(Math.max(0, maxOut));
    let outIdx = 0;
    let pos = this.phase;

    while (pos < input.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 < 0 ? this.lastSample : input[i0];
      const s1 = i0 + 1 < input.length ? input[i0 + 1] : input[input.length - 1];
      out[outIdx++] = s0 + (s1 - s0) * frac;
      pos += this.ratio;
    }

    this.phase = pos - input.length;
    this.lastSample = input[input.length - 1];
    return out.subarray(0, outIdx);
  }

  reset(): void {
    this.phase = 0;
    this.lastSample = 0;
    this.primed = false;
  }
}

/**
 * Encode a microphone Float32 chunk into the exact base64 16kHz PCM payload
 * expected by `realtimeInput.audio`.
 */
export function encodeMicChunk(
  samples: Float32Array,
  resampler: StreamResampler
): { base64: string; mimeType: string; sampleCount: number } {
  const resampled = resampler.process(samples);
  const pcm16 = floatTo16BitPCM(resampled);
  const bytes = int16ToBytesLE(pcm16);
  return {
    base64: bytesToBase64(bytes),
    mimeType: `audio/pcm;rate=${resampler.toRate}`,
    sampleCount: pcm16.length,
  };
}

/**
 * Decode a `serverContent.modelTurn` inlineData audio chunk into Float32 samples.
 */
export function decodeModelAudio(
  base64: string,
  mimeType = `audio/pcm;rate=${PLAYBACK_SAMPLE_RATE}`
): { samples: Float32Array; sampleRate: number } {
  const rateMatch = /rate=(\d+)/i.exec(mimeType);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : PLAYBACK_SAMPLE_RATE;
  const bytes = base64ToBytes(base64);
  const pcm16 = bytesLEToInt16(bytes);
  return {
    samples: pcm16ToFloat(pcm16),
    sampleRate,
  };
}

/**
 * Root-mean-square level in [0, 1] for driving the acoustic voice waveform indicator.
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

export const PCM_CAPTURE_WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(640);
    this._offset = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let idx = 0;
    while (idx < channel.length) {
      const remaining = this._buffer.length - this._offset;
      const toCopy = Math.min(remaining, channel.length - idx);
      this._buffer.set(channel.subarray(idx, idx + toCopy), this._offset);
      this._offset += toCopy;
      idx += toCopy;
      if (this._offset >= this._buffer.length) {
        const chunk = this._buffer.slice();
        this.port.postMessage({ samples: chunk }, [chunk.buffer]);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
`;

export const PCM_PLAYBACK_WORKLET_SOURCE = `
class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._offset = 0;
    this._playing = false;
    this.port.onmessage = (event) => {
      if (event.data === 'clear') {
        this._queue = [];
        this._offset = 0;
        if (this._playing) {
          this._playing = false;
          this.port.postMessage({ playing: false });
        }
      } else if (event.data instanceof Float32Array && event.data.length > 0) {
        this._queue.push(event.data);
        if (!this._playing) {
          this._playing = true;
          this.port.postMessage({ playing: true });
        }
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    let outIdx = 0;
    while (outIdx < output.length && this._queue.length > 0) {
      const current = this._queue[0];
      const available = current.length - this._offset;
      const needed = output.length - outIdx;
      const count = Math.min(available, needed);
      for (let i = 0; i < count; i++) {
        output[outIdx + i] = current[this._offset + i];
      }
      outIdx += count;
      this._offset += count;
      if (this._offset >= current.length) {
        this._queue.shift();
        this._offset = 0;
      }
    }
    while (outIdx < output.length) {
      output[outIdx++] = 0;
    }
    if (this._queue.length === 0 && this._playing) {
      this._playing = false;
      this.port.postMessage({ playing: false });
    }
    return true;
  }
}
registerProcessor('pcm-playback-processor', PCMPlaybackProcessor);
`;

export interface LiveAudioEngineCallbacks {
  onMicChunk: (chunk: { base64: string; mimeType: string; level: number }) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onLevelChange?: (level: number) => void;
}

/**
 * Prompts the user for microphone permission via a top-level extension tab
 * when called from a Chrome extension side panel or popup where native
 * permission prompts cannot be rendered directly.
 */
export async function requestExtensionMicrophonePermission(): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
    const permUrl = chrome.runtime.getURL('permission.html');
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      let createdTabId: number | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const settle = (granted: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        chrome.runtime?.onMessage?.removeListener?.(onMessage);
        chrome.tabs?.onRemoved?.removeListener?.(onTabRemoved);
        resolve(granted);
      };

      const onMessage = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: string }).type === 'WEBMCP_MIC_PERMISSION_RESULT'
        ) {
          settle(Boolean((msg as { granted?: boolean }).granted));
        }
      };

      const onTabRemoved = (closedTabId: number) => {
        if (createdTabId !== undefined && closedTabId === createdTabId) {
          settle(false);
        }
      };

      chrome.runtime?.onMessage?.addListener?.(onMessage);
      chrome.tabs?.onRemoved?.addListener?.(onTabRemoved);

      chrome.tabs.create({ url: permUrl, active: true }, (tab?: chrome.tabs.Tab) => {
        if (chrome.runtime?.lastError) {
          settle(false);
          return;
        }
        createdTabId = tab?.id;
      });

      timeoutId = setTimeout(() => settle(false), 60000);
    });
  }
  return false;
}

async function loadAudioWorkletModule(
  ctx: AudioContext,
  filename: string,
  fallbackSource: string
): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const extUrl = chrome.runtime.getURL(filename);
    try {
      await ctx.audioWorklet.addModule(extUrl);
      return;
    } catch (e) {
      console.warn(`[WebMCP] Could not load audio worklet from ${extUrl}, falling back to Blob URL`, e);
    }
  }

  const blob = new Blob([fallbackSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Web Audio AudioWorklet hardware pipeline for 16kHz mic capture and 24kHz
 * gapless model audio playback with instant barge-in flushing.
 */
export class LiveAudioEngine {
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;
  private playbackWorkletNode: AudioWorkletNode | null = null;
  private resampler: StreamResampler | null = null;
  private muted = false;
  private callbacks: LiveAudioEngineCallbacks;

  constructor(callbacks: LiveAudioEngineCallbacks) {
    this.callbacks = callbacks;
  }

  async startCapture(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not available in this context.');
    }

    const micConstraints: MediaStreamConstraints = {
      audio: {
        sampleRate: MIC_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(micConstraints);
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name || '';
      const errMsg = (err as { message?: string })?.message || String(err || '');
      const isPermissionDenied =
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errMsg.toLowerCase().includes('permission dismissed');

      if (isPermissionDenied) {
        const granted = await requestExtensionMicrophonePermission();
        if (granted) {
          this.mediaStream = await navigator.mediaDevices.getUserMedia(micConstraints);
        } else {
          throw new Error(
            'Microphone access is required for Voice Mode. Please click Allow in the opened tab to continue.'
          );
        }
      } else {
        throw err;
      }
    }

    const AudioCtx =
      globalThis.AudioContext ||
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.captureCtx = new AudioCtx({ sampleRate: MIC_SAMPLE_RATE });
    if (this.captureCtx.state === 'suspended') {
      await this.captureCtx.resume();
    }
    this.resampler = new StreamResampler(this.captureCtx.sampleRate, MIC_SAMPLE_RATE);
    await loadAudioWorkletModule(
      this.captureCtx,
      'pcm-capture-processor.js',
      PCM_CAPTURE_WORKLET_SOURCE
    );

    this.sourceNode = this.captureCtx.createMediaStreamSource(this.mediaStream);
    this.captureWorkletNode = new AudioWorkletNode(this.captureCtx, 'pcm-capture-processor');

    this.captureWorkletNode.port.onmessage = (event: MessageEvent<{ samples?: Float32Array }>) => {
      if (this.muted || !event.data?.samples || !this.resampler) return;
      const samples = event.data.samples;
      const level = rms(samples);
      this.callbacks.onLevelChange?.(level);
      const encoded = encodeMicChunk(samples, this.resampler);
      if (encoded.sampleCount > 0) {
        this.callbacks.onMicChunk({
          base64: encoded.base64,
          mimeType: encoded.mimeType,
          level,
        });
      }
    };

    this.sourceNode.connect(this.captureWorkletNode);
  }

  private async ensurePlaybackNode(): Promise<AudioWorkletNode> {
    if (this.playbackWorkletNode && this.playbackCtx) {
      if (this.playbackCtx.state === 'suspended') {
        await this.playbackCtx.resume();
      }
      return this.playbackWorkletNode;
    }

    const AudioCtx =
      globalThis.AudioContext ||
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.playbackCtx = new AudioCtx({ sampleRate: PLAYBACK_SAMPLE_RATE });
    if (this.playbackCtx.state === 'suspended') {
      await this.playbackCtx.resume();
    }

    await loadAudioWorkletModule(
      this.playbackCtx,
      'pcm-playback-processor.js',
      PCM_PLAYBACK_WORKLET_SOURCE
    );

    this.playbackWorkletNode = new AudioWorkletNode(this.playbackCtx, 'pcm-playback-processor');
    this.playbackWorkletNode.port.onmessage = (event: MessageEvent<{ playing?: boolean }>) => {
      if (typeof event.data?.playing === 'boolean') {
        this.callbacks.onPlaybackStateChange?.(event.data.playing);
      }
    };
    this.playbackWorkletNode.connect(this.playbackCtx.destination);
    return this.playbackWorkletNode;
  }

  async enqueuePlayback(base64Audio: string, mimeType?: string): Promise<void> {
    const node = await this.ensurePlaybackNode();
    const { samples } = decodeModelAudio(base64Audio, mimeType);
    if (samples.length === 0) return;
    const level = rms(samples);
    this.callbacks.onLevelChange?.(level);
    node.port.postMessage(samples, [samples.buffer]);
  }

  clearPlayback(): void {
    if (this.playbackWorkletNode) {
      this.playbackWorkletNode.port.postMessage('clear');
    }
    this.callbacks.onPlaybackStateChange?.(false);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    if (muted) {
      this.callbacks.onLevelChange?.(0);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  async stop(): Promise<void> {
    this.clearPlayback();
    if (this.captureWorkletNode) {
      try {
        this.captureWorkletNode.port.onmessage = null;
        this.captureWorkletNode.disconnect();
      } catch {
        // ignore disconnect errors during teardown
      }
      this.captureWorkletNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.playbackWorkletNode) {
      try {
        this.playbackWorkletNode.port.onmessage = null;
        this.playbackWorkletNode.disconnect();
      } catch {
        // ignore
      }
      this.playbackWorkletNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.captureCtx) {
      try {
        await this.captureCtx.close();
      } catch {
        // ignore
      }
      this.captureCtx = null;
    }
    if (this.playbackCtx) {
      try {
        await this.playbackCtx.close();
      } catch {
        // ignore
      }
      this.playbackCtx = null;
    }
  }
}
