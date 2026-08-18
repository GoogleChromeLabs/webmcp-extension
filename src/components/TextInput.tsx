/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';

export interface TextInputProps {
  value?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  active?: boolean;
  className?: string;
}

/**
 * TextInput Component
 * Main user prompt entry field with Enter-to-submit keyboard support.
 */
export function TextInput({
  value = '',
  placeholder = 'Ask Agent anything',
  active = false,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onSubmit,
  readOnly,
  className = '',
}: TextInputProps) {
  const isActive = active;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (onKeyDown) onKeyDown(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (onSubmit) onSubmit();
    }
  };

  return (
    <div className={`text-input ${isActive ? 'text-input--active' : ''} ${className}`.trim()}>
      <input
        type="text"
        className="text-input__field"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
      />
    </div>
  );
}

export default TextInput;
