/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
