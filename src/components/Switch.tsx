/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
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
  id,
  className = '',
}: SwitchProps) {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
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
