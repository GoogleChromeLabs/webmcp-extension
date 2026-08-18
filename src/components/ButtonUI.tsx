/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayArrowIcon, SquareStopIcon } from './Icons';

export interface ButtonUIProps {
  property1?: 'Live Button' | 'Send Button' | 'Stop Button';
  property2?: 'Default' | 'Pressed';
  type?: 'Live Button' | 'Send Button' | 'Stop Button';
  state?: 'Default' | 'Pressed';
  onClick?: () => void;
  className?: string;
}

/**
 * ButtonUI Component
 */
export function ButtonUI({
  property1,
  type = 'Live Button',
  property2,
  state = 'Default',
  onClick,
  className = '',
}: ButtonUIProps) {
  const buttonType = property1 || type;
  const buttonState = property2 || state;

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
    <button className={classNames.join(' ')} onClick={onClick} aria-label={buttonType}>
      <div className="button-ui__icon-wrapper">{renderIcon()}</div>
    </button>
  );
}

export default ButtonUI;
