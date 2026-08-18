/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';

export interface TextInputProps {
  active?: boolean;
  value?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
  className?: string;
}

/**
 * TextInput Component
 * Input field for user prompt composition.
 */
export function TextInput({
  active = false,
  value = '',
  placeholder = 'Ask Agent anything',
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onSubmit,
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
    <div className={`text-input ${className}`}>
      {!isActive && !value && <span className="text-input__cursor" />}
      <input
        type="text"
        className="text-input__field"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
      />
      {isActive && <span className="text-input__cursor" />}
    </div>
  );
}

export default TextInput;

