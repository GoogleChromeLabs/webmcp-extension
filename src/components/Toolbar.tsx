/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AttachFileIcon } from './Icons.js';
import { ModelPicker, ModelPickerDropdown } from './ModelPicker.js';
import { ButtonUI } from './ButtonUI.js';
import { ProviderKey } from '../types/index.js';

export interface ToolbarProps {
  onAttach?: () => void;
  selectedProvider?: ProviderKey;
  selectedModel?: string;
  isModelPickerOpen?: boolean;
  onModelPickerToggle?: () => void;
  onSelectModel?: (provider: ProviderKey, model: string) => void;
  onCloseModelPicker?: () => void;
  onModelPickerClick?: () => void;
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
  selectedProvider = 'gemini',
  selectedModel = 'gemini-3.5-flash',
  isModelPickerOpen = false,
  onModelPickerToggle,
  onSelectModel,
  onCloseModelPicker,
  onModelPickerClick,
  actionButtonType = 'Live Button',
  actionButtonState = 'Default',
  onActionButtonClick,
  className = '',
}: ToolbarProps) {
  return (
    <div className={`toolbar ${className}`}>
      <div className="toolbar__lhs">
        {/* TODO: Attachments to be implemented
        <button
          type="button"
          className="toolbar__attach-btn"
          onClick={onAttach}
          title="Attach tab context"
          aria-label="Attach file"
        >
          <AttachFileIcon size={20} className="toolbar__attach-icon" />
        </button>
        */}
      </div>
      <div className="toolbar__rhs model-dropdown-container">
        <ModelPicker
          selectedModel={selectedModel}
          isOpen={isModelPickerOpen}
          onToggle={onModelPickerToggle || onModelPickerClick}
        />
        {isModelPickerOpen && (
          <ModelPickerDropdown
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            onClose={onCloseModelPicker}
          />
        )}
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
