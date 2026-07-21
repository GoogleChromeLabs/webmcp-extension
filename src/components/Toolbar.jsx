import React from 'react';
import { AttachFileIcon } from './Icons.jsx';
import { ModelPicker, ModelPickerDropdown } from './ModelPicker.jsx';
import { ButtonUI } from './ButtonUI.jsx';

/**
 * Toolbar Component
 * Figma Node ID: 3344:8873
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
  className = ''
}) {
  return (
    <div className={`nexus-toolbar ${className}`} data-node-id="3344:8873">
      <div className="nexus-toolbar__lhs" data-node-id="3344:8548">
        <button
          className="nexus-toolbar__attach-btn"
          onClick={onAttach}
          aria-label="Attach file"
          data-node-id="3344:8549"
        >
          <AttachFileIcon size={20} className="nexus-toolbar__attach-icon" />
        </button>
      </div>
      <div className="nexus-toolbar__rhs nexus-model-dropdown-container" data-node-id="3344:8552">
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
