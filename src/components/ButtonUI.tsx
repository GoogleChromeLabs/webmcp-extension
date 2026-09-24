/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlayArrowIcon, SquareStopIcon } from './Icons.js';

export type ButtonVariant = 'live' | 'send' | 'stop';

export interface ButtonUIProps {
  variant?: ButtonVariant;
  onClick?: () => void;
}

/**
 * ButtonUI Component
 * Circular action button rendered in the prompt composer toolbar.
 */
export function ButtonUI({ variant = 'live', onClick }: ButtonUIProps) {
  const isStop = variant === 'stop';

  return (
    <button type="button" className="button-ui" onClick={onClick} aria-label={variant}>
      <div className="button-ui__icon-wrapper">
        {isStop ? (
          <SquareStopIcon size={12} color="#ffffff" />
        ) : (
          <PlayArrowIcon size={14} color="#ffffff" />
        )}
      </div>
    </button>
  );
}
