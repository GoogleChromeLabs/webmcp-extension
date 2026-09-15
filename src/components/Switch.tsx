/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * Blocks toggling while keeping the switch focusable, so a screen reader
   * still finds it and hears why it cannot be changed: exposed as
   * `aria-disabled` rather than the `disabled` attribute.
   */
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  className?: string;
}

/**
 * Material Design Switch Toggle Component
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id,
  className = '',
}: SwitchProps) {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      // Also when disabled: the button would otherwise turn the key into a
      // click of its own.
      e.preventDefault();
      if (!disabled) onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      id={id}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`cdds-switch ${checked ? 'cdds-switch--checked' : ''} ${className}`}
    >
      <span className="cdds-switch__track" aria-hidden="true" />
      <span className="cdds-switch__thumb" aria-hidden="true" />
    </button>
  );
}

export default Switch;
