/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayArrowIcon, SquareStopIcon } from './Icons';

export interface ButtonUIProps {
  type?: 'Live Button' | 'Send Button' | 'Stop Button';
  state?: 'Default' | 'Pressed';
  onClick?: () => void;
  className?: string;
}

/**
 * ButtonUI Component
 * Primary circular action trigger (Play Arrow for Send/Live, Square for Stop).
 */
export function ButtonUI({
  type = 'Live Button',
  state = 'Default',
  onClick,
  className = '',
}: ButtonUIProps) {
  const buttonType = type;
  const buttonState = state;

  const classNames = ['button-ui'];
  if (buttonState === 'Pressed') classNames.push('button-ui--pressed');
  if (className) classNames.push(className);

  const renderIcon = () => {
    switch (buttonType) {
      case 'Stop Button':
        return <SquareStopIcon size={12} color="#ffffff" />;
      case 'Send Button':
      case 'Live Button':
      default:
        return <PlayArrowIcon size={14} color="#ffffff" />;
    }
  };

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={buttonType}
    >
      <div className="button-ui__icon-wrapper">{renderIcon()}</div>
    </button>
  );
}

export default ButtonUI;
