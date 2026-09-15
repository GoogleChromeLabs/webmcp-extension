/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ContextUsage } from '../services/promptApiBackend.js';

/**
 * ContextMeter Component
 * Shows how much of the on-device model's context the conversation takes up.
 * The context is small, so it fills within a few tool results, and once it
 * overflows the conversation is compacted, which the next message waits for.
 */
export function ContextMeter({ used, window }: ContextUsage) {
  if (!(window > 0)) return null;
  const percent = Math.min(100, Math.round((used / window) * 100));
  const tokens = `${used.toLocaleString()} of ${window.toLocaleString()} tokens`;

  return (
    <div className="context-meter" title={`Context: ${tokens}`}>
      <meter
        className="context-meter__bar"
        min={0}
        max={window}
        value={Math.min(used, window)}
        low={Math.round(window * 0.6)}
        high={Math.round(window * 0.85)}
        optimum={0}
        aria-label="Context used by the conversation"
        aria-valuetext={`${percent}%, ${tokens}`}
      />
      <span className="context-meter__label" aria-hidden="true">
        {`${percent}%`}
      </span>
    </div>
  );
}

export default ContextMeter;
