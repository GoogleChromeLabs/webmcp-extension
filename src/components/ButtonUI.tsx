/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayArrowIcon, SquareStopIcon } from './Icons.js';

export type ButtonVariant = 'live' | 'send' | 'stop';

export interface ButtonUIProps {
  variant?: ButtonVariant;
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * ButtonUI Component
 * Circular action button rendered in the prompt composer toolbar.
 */
export function ButtonUI({
  variant = 'live',
  pressed = false,
  onClick,
  className = '',
}: ButtonUIProps) {
  const isStop = variant === 'stop';

  const classNames = ['button-ui'];
  if (pressed) classNames.push('button-ui--pressed');
  if (className) classNames.push(className);

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={variant}
    >
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

export default ButtonUI;

