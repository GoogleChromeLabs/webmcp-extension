/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { PROVIDERS } from '../providers.js';
import { SymbolIcon, KeyboardArrowDownIcon, KeyboardArrowUpIcon } from './Icons.js';
import { ProviderKey } from '../types/index.js';

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3-flash-preview': 'Gemini 3 Flash',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
  'gpt-5.1': 'GPT 5.1',
  'gpt-5-mini': 'GPT 5 Mini',
  'gpt-4.1': 'GPT 4.1',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
};

export interface ModelPickerProps {
  modelName?: string;
  selectedModel?: string;
  isOpen?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  className?: string;
}

/**
 * ModelPicker Component
 */
export function ModelPicker({
  modelName,
  selectedModel = 'gemini-3.5-flash',
  isOpen = false,
  onToggle,
  onClick,
  className = '',
}: ModelPickerProps) {
  const isPressed = isOpen;
  const classNames = ['model-picker'];
  if (isPressed) classNames.push('model-picker--pressed');
  if (className) classNames.push(className);

  const activeModelKey = modelName || selectedModel;
  const displayLabel = MODEL_DISPLAY_NAMES[activeModelKey] || activeModelKey;

  return (
    <button
      className={classNames.join(' ')}
      onClick={onToggle || onClick}
      title="Select AI model"
    >
      <span className="model-picker__label">{displayLabel}</span>
      {isPressed ? (
        <KeyboardArrowUpIcon size={16} className="model-picker__icon" />
      ) : (
        <KeyboardArrowDownIcon size={16} className="model-picker__icon" />
      )}
    </button>
  );
}

export interface ModelPickerDropdownProps {
  selectedProvider?: ProviderKey;
  selectedModel?: string;
  onSelectModel?: (provider: ProviderKey, model: string) => void;
  onClose?: () => void;
  className?: string;
}

/**
 * ModelPickerDropdown Component
 * Dropdown popover menu listing available AI providers & models.
 */
export function ModelPickerDropdown({
  selectedProvider = 'gemini',
  selectedModel = 'gemini-3.5-flash',
  onSelectModel,
  onClose,
  className = '',
}: ModelPickerDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className={`model-dropdown ${className}`}
    >
      {Object.entries(PROVIDERS).map(([providerKey, providerObj]) => (
        <div key={providerKey} className="model-dropdown__group">
          <div className="model-dropdown__group-title">
            {providerObj.label}
          </div>
          {providerObj.models.map((modelId) => {
            const isSelected = providerKey === selectedProvider && modelId === selectedModel;
            const label = MODEL_DISPLAY_NAMES[modelId] || modelId;
            return (
              <button
                key={modelId}
                className={`model-dropdown__item ${
                  isSelected ? 'model-dropdown__item--selected' : ''
                }`}
                onClick={() => {
                  onSelectModel?.(providerKey as ProviderKey, modelId);
                  onClose?.();
                }}
              >
                <span className="model-dropdown__item-label">{label}</span>
                {isSelected && (
                  <SymbolIcon name="check" size={16} color="#0b57d0" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default ModelPicker;
