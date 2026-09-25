/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
