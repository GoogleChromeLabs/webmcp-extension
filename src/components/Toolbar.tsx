/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ButtonUI, ButtonVariant } from './ButtonUI.js';

export interface ToolbarProps {
  actionVariant?: ButtonVariant;
  actionPressed?: boolean;
  onActionClick?: () => void;
  className?: string;
  // Legacy aliases for backward compatibility
  actionButtonType?: ButtonVariant;
  actionButtonState?: 'Default' | 'Pressed';
  onActionButtonClick?: () => void;
}

/**
 * Toolbar Component
 * Toolbar footer inside the prompt composer.
 */
export function Toolbar({
  actionVariant,
  actionPressed,
  onActionClick,
  actionButtonType = 'live',
  actionButtonState = 'Default',
  onActionButtonClick,
  className = '',
}: ToolbarProps) {
  const variant = actionVariant || actionButtonType;
  const isPressed = actionPressed ?? (actionButtonState === 'Pressed');
  const handleClick = onActionClick || onActionButtonClick;

  return (
    <div className={`toolbar ${className}`}>
      <ButtonUI
        variant={variant}
        pressed={isPressed}
        onClick={handleClick}
      />
    </div>
  );
}

export default Toolbar;

