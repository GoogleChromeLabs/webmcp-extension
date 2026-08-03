/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ButtonUI } from './ButtonUI.js';

export interface ToolbarProps {
  onAttach?: () => void;
  actionButtonType?: 'Live Button' | 'Send Button' | 'Stop Button';
  actionButtonState?: 'Default' | 'Pressed';
  onActionButtonClick?: () => void;
  className?: string;
}

/**
 * Toolbar Component
 */
export function Toolbar({
  onAttach,
  actionButtonType = 'Live Button',
  actionButtonState = 'Default',
  onActionButtonClick,
  className = '',
}: ToolbarProps) {
  return (
    <div className={`toolbar ${className}`}>
      <div className="toolbar__lhs">
      </div>
      <div className="toolbar__rhs">
        <ButtonUI
          property1={actionButtonType}
          property2={actionButtonState}
          onClick={onActionButtonClick}
        />
      </div>
    </div>
  );
}

export default Toolbar;
