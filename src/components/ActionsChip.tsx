/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AutomationIcon } from './Icons';

export interface ActionsChipProps {
  label?: string;
  disabled?: boolean;
  disabledLabel?: string;
  state?: 'Closed' | 'Hover' | 'Pressed';
  onClick?: () => void;
  className?: string;
}

/**
 * ActionsChip Component
 * Interactive chip showing the count of discovered WebMCP tools on the page.
 */
export function ActionsChip({
  label = '5 tools',
  disabled = false,
  disabledLabel = 'WebMCP disabled',
  state: stateProp,
  onClick,
  className = '',
}: ActionsChipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const isDisabled = disabled;

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
      type="button"
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
