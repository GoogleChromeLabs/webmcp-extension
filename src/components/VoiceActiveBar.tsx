/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CSSProperties } from 'react';
import type { VoiceStatus } from '../services/geminiLive.js';
import { CloseIcon, MicIcon, MicOffIcon } from './Icons.js';

export interface VoiceActiveBarProps {
  status: VoiceStatus;
  muted?: boolean;
  interimText?: string;
  level?: number;
  model?: string;
  onToggleMute?: () => void;
  onInterrupt?: () => void;
  onStop?: () => void;
}

/**
 * VoiceActiveBar Component
 * Compact status & control bar displayed inside the composer when Gemini Live
 * voice mode is active, showing acoustic activity, live status/transcript preview,
 * barge-in interrupt, mute toggle, and session stop.
 */
export function VoiceActiveBar({
  status,
  muted = false,
  interimText = '',
  level = 0,
  model = 'gemini-3.8-live',
  onToggleMute,
  onInterrupt,
  onStop,
}: VoiceActiveBarProps) {
  const waveStateClass = muted
    ? 'muted'
    : status === 'speaking'
      ? 'speaking'
      : status === 'listening'
        ? 'listening'
        : status === 'tool'
          ? 'tool'
          : 'connecting';

  let statusLabel = 'Listening — speak naturally';
  if (status === 'connecting') {
    statusLabel = `Connecting (${model})…`;
  } else if (muted) {
    statusLabel = 'Microphone muted';
  } else if (status === 'speaking') {
    statusLabel = 'Agent responding…';
  } else if (status === 'tool') {
    statusLabel = 'Running WebMCP action…';
  } else if (interimText.trim()) {
    statusLabel = `Listening: "${interimText.trim()}"`;
  }

  const normalizedLevel = Math.min(1, Math.max(0, level * 4));
  const waveStyle = {
    '--voice-level': normalizedLevel.toFixed(2),
  } as CSSProperties;

  return (
    <div
      className={`voice-active-bar voice-active-bar--${waveStateClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="voice-active-bar__status">
        <div
          className={`voice-wave-container ${waveStateClass}`}
          style={waveStyle}
          aria-hidden="true"
        >
          <span className="voice-wave-bar" />
          <span className="voice-wave-bar" />
          <span className="voice-wave-bar" />
          <span className="voice-wave-bar" />
        </div>
        <span className="voice-active-bar__text" title={statusLabel}>
          {statusLabel}
        </span>
      </div>

      <div className="voice-active-bar__actions">
        {status === 'speaking' && onInterrupt && (
          <button
            type="button"
            className="voice-active-bar__pill-btn"
            onClick={onInterrupt}
            title="Interrupt spoken response"
          >
            Interrupt
          </button>
        )}

        {onToggleMute && (
          <button
            type="button"
            className={`voice-active-bar__icon-btn ${muted ? 'voice-active-bar__icon-btn--muted' : ''}`}
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
          </button>
        )}

        {onStop && (
          <button
            type="button"
            className="voice-active-bar__icon-btn voice-active-bar__icon-btn--end"
            onClick={onStop}
            aria-label="End voice mode"
            title="End voice mode"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default VoiceActiveBar;
