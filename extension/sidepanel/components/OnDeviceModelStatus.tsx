/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ContextUsage, type DownloadProgress, setOnDeviceModelUi } from '../services/promptApiBackend.js';

/**
 * How far compacting has got, when its status says so ("Compacting message 3
 * of 12…"), as a fraction for the progress bar. Anything else leaves the bar
 * indeterminate.
 */
export function getCompactingFraction(status: string): number | null {
  const match = /(\d+) of (\d+)/.exec(status);
  if (!match) return null;
  const [done, total] = [Number(match[1]), Number(match[2])];
  return total > 0 ? Math.min(done / total, 1) : null;
}

export interface OnDeviceModelStatusProps {
  /** Called with how much of the context the conversation takes up. */
  onContextUsage?: (usage: ContextUsage | null) => void;
  /**
   * Where to show the status, when the chat card's header is on screen: the
   * component stays mounted here so a download survives opening settings or
   * the first message, and only its elements move.
   */
  slot?: HTMLElement | null;
}

/**
 * OnDeviceModelStatus Component
 * Shows what the on-device model is busy with before it can answer: its
 * download, and compacting a long conversation.
 *
 * The download elements are handed to the Prompt API backend, which reveals
 * the button when the download needs a click and drives the progress bar, so
 * they start out hidden and React leaves their `hidden` attribute alone after
 * that.
 */
export function OnDeviceModelStatus({ onContextUsage, slot }: OnDeviceModelStatusProps = {}) {
  const hintRef = useRef<HTMLParagraphElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const progressRef = useRef<HTMLProgressElement | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [compacting, setCompacting] = useState<string | null>(null);
  const onContextUsageRef = useRef(onContextUsage);
  onContextUsageRef.current = onContextUsage;
  // The status always renders into this one element, which moves between its
  // own spot and `slot`: portaling straight into `slot` would have React build
  // new elements every time `slot` comes or goes, leaving the backend driving
  // the old ones. There is no `document` to make it with when rendering to a
  // string.
  const [host] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'model-status-host';
    return element;
  });
  const homeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (host) (slot ?? homeRef.current)?.append(host);
  }, [host, slot]);

  useEffect(() => {
    setOnDeviceModelUi({
      activationHint: hintRef.current ?? undefined,
      activationButton: buttonRef.current ?? undefined,
      downloadProgress: progressRef.current ?? undefined,
      onDownloadProgress: setProgress,
      onCompacting: setCompacting,
      onContextUsage: (usage) => onContextUsageRef.current?.(usage),
    });
    return () => setOnDeviceModelUi();
  }, []);

  const modelPercent = progress?.resource === 'language-model' ? progress.percent : 0;
  // Once every byte is in, the model still has to be unpacked, which takes an
  // unknown amount of time: the bar goes indeterminate then.
  const downloadLabel =
    modelPercent < 100 ? `Downloading the on-device model… ${modelPercent}%` : 'Preparing the on-device model…';

  // The first compaction on a device may have to download the Summarizer and
  // the Language Detector before it can start.
  const helperDownload =
    progress && progress.resource !== 'language-model' && progress.percent < 100 ? progress : null;
  const compactingLabel = helperDownload
    ? `Downloading the ${helperDownload.resource.replace('-', ' ')}… ${helperDownload.percent}%`
    : compacting;
  const compactingFraction = helperDownload
    ? helperDownload.percent / 100
    : compacting && getCompactingFraction(compacting);

  const status = (
    <div className="model-status" aria-live="polite">
      <p ref={hintRef} className="model-status__hint" hidden>
        The on-device model needs to be downloaded before it can answer.
      </p>
      <button ref={buttonRef} type="button" className="model-status__btn" hidden>
        Download model
      </button>
      <progress ref={progressRef} className="model-status__progress" aria-label="On-device model download" hidden />
      <span className="model-status__label">{downloadLabel}</span>
      <div className="model-status__compacting" hidden={compacting === null}>
        {/* Keyed apart: React cannot turn a bar with a value back into an indeterminate one. */}
        {typeof compactingFraction === 'number' ? (
          <progress
            key="determinate"
            className="model-status__progress"
            aria-label="Compacting the conversation"
            value={compactingFraction}
            max={1}
          />
        ) : (
          <progress key="indeterminate" className="model-status__progress" aria-label="Compacting the conversation" />
        )}
        <span className="model-status__label">{compactingLabel}</span>
      </div>
    </div>
  );

  if (!host) return status;
  return (
    <div ref={homeRef} className="model-status-host">
      {createPortal(status, host)}
    </div>
  );
}
