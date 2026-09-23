/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayArrowIcon, SquareStopIcon } from './Icons.js';

export type ButtonVariant = 'live' | 'send' | 'stop';

export interface ButtonUIProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  pressed?: boolean;
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
  type = 'button',
  'aria-label': ariaLabel,
  ...restProps
}: ButtonUIProps) {
  const isStop = variant === 'stop';

  const classNames = ['button-ui'];
  if (pressed) classNames.push('button-ui--pressed');
  if (className) classNames.push(className);

  return (
    <button
      type={type}
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={ariaLabel || variant}
      {...restProps}
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
