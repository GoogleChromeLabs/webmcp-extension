/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AutomationIcon } from './Icons';

export interface ActionsChipProps {
  property1?: 'Enabled' | 'Disabled';
  state?: 'Closed' | 'Hover' | 'Pressed';
  label?: string;
  disabledLabel?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * ActionsChip Component
 */
export function ActionsChip({
  property1 = 'Enabled',
  state: stateProp,
  label = '5 tools',
  disabledLabel = 'WebMCP disabled',
  onClick,
  className = '',
}: ActionsChipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const isDisabled = property1 === 'Disabled';

  let currentState = stateProp;
  if (!currentState) {
    if (isPressed) currentState = 'Pressed';
    else if (isHovered) currentState = 'Hover';
    else currentState = 'Closed';
  }

  const isClosed = currentState === 'Closed';
  const displayLabel = isDisabled ? disabledLabel : label;

  const classNames = [
    'actions-chip',
    `actions-chip--${isDisabled ? 'disabled' : 'enabled'}`,
    `actions-chip--${currentState.toLowerCase()}`,
  ];
  if (className) classNames.push(className);

  return (
    <button
      className={classNames.join(' ')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onClick={onClick}
      title={isClosed ? displayLabel : undefined}
    >
      <div className="actions-chip__icon-wrapper">
        <AutomationIcon size={16} color="currentColor" />
      </div>

      <span className="actions-chip__label">{displayLabel}</span>
    </button>
  );
}

export default ActionsChip;
