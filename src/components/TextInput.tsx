/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';

export interface TextInputProps {
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
  value = '',
  placeholder = 'Ask Agent anything',
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onSubmit,
  className = '',
}: TextInputProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (onKeyDown) onKeyDown(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (onSubmit) onSubmit();
    }
  };

  return (
    <div className={`text-input ${className}`}>
      <input
        type="text"
        className="text-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

