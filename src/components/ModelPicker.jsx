import React, { useEffect, useRef } from 'react';
import { PROVIDERS } from '../providers.jsx';
import { SymbolIcon, KeyboardArrowDownIcon, KeyboardArrowUpIcon } from './Icons.jsx';

export const MODEL_DISPLAY_NAMES = {
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

/**
 * ModelPicker Component
 * Figma Node ID: 3344:8861 ("Model picker")
 */
export function ModelPicker({
  modelName,
  selectedModel = 'gemini-3.5-flash',
  isOpen = false,
  onToggle,
  onClick,
  className = ''
}) {
  const isPressed = isOpen;
  let classNames = ['nexus-model-picker'];
  if (isPressed) classNames.push('nexus-model-picker--pressed');
  if (className) classNames.push(className);

  const activeModelKey = modelName || selectedModel;
  const displayLabel = MODEL_DISPLAY_NAMES[activeModelKey] || activeModelKey;

  return (
    <button
      className={classNames.join(' ')}
      onClick={onToggle || onClick}
      data-node-id="3344:8861"
      data-state={isPressed ? 'Pressed' : 'Default'}
      title="Select AI model"
    >
      <span className="nexus-model-picker__label">{displayLabel}</span>
      {isPressed ? (
        <KeyboardArrowUpIcon size={16} className="nexus-model-picker__icon" />
      ) : (
        <KeyboardArrowDownIcon size={16} className="nexus-model-picker__icon" />
      )}
    </button>
  );
}

/**
 * ModelPickerDropdown Component
 * Dropdown popover menu listing available AI providers & models matching Figma design specs.
 */
export function ModelPickerDropdown({
  selectedProvider = 'gemini',
  selectedModel = 'gemini-3.5-flash',
  onSelectModel,
  onClose,
  className = ''
}) {
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className={`nexus-model-dropdown ${className}`}
      data-node-id="3344:8861-dropdown"
    >
      {Object.entries(PROVIDERS).map(([providerKey, providerObj]) => (
        <div key={providerKey} className="nexus-model-dropdown__group">
          <div className="nexus-model-dropdown__group-title">
            {providerObj.label}
          </div>
          {providerObj.models.map((modelId) => {
            const isSelected = providerKey === selectedProvider && modelId === selectedModel;
            const label = MODEL_DISPLAY_NAMES[modelId] || modelId;
            return (
              <button
                key={modelId}
                className={`nexus-model-dropdown__item ${
                  isSelected ? 'nexus-model-dropdown__item--selected' : ''
                }`}
                onClick={() => {
                  onSelectModel?.(providerKey, modelId);
                  onClose?.();
                }}
              >
                <span className="nexus-model-dropdown__item-label">{label}</span>
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
