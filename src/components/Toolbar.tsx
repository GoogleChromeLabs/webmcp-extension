/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ButtonUI } from './ButtonUI';

export interface ToolbarProps {
  onAttach?: () => void;
  actionButtonType?: 'Live Button' | 'Send Button' | 'Stop Button';
  actionButtonState?: 'Default' | 'Pressed';
  onActionButtonClick?: () => void;
  className?: string;
}

/**
 * Toolbar Component
 * Container for the composer bottom action button.
 */
export function Toolbar({
  actionButtonType = 'Live Button',
  actionButtonState = 'Default',
  onActionButtonClick,
  className = '',
}: ToolbarProps) {
  return (
    <div className={`toolbar ${className}`}>
      <div className="toolbar__lhs" />
      <div className="toolbar__rhs">
        <ButtonUI type={actionButtonType} state={actionButtonState} onClick={onActionButtonClick} />
      </div>
    </div>
  );
}

export default Toolbar;
