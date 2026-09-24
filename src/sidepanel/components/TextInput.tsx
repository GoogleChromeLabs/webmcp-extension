/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChangeEvent, KeyboardEvent } from 'react';

export interface TextInputProps {
  value?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
}

/**
 * TextInput Component
 * Input field for user prompt composition.
 */
export function TextInput({
  value = '',
  placeholder = 'Ask Agent anything',
  onChange,
  onSubmit,
}: TextInputProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (onSubmit) onSubmit();
    }
  };

  return (
    <div className="text-input">
      <input
        type="text"
        className="text-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={onChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
