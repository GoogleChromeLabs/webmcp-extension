/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface SettingsModalProps {
  isOpen: boolean;
  suggestPrompt?: boolean;
  onClose: () => void;
  onToggleSuggestPrompt: (checked: boolean) => void;
}

/**
 * SettingsModal Component
 * Configuration dialog for Agent Options.
 * Renders as a floating modal popup overlay.
 */
export function SettingsModal({
  isOpen,
  suggestPrompt = true,
  onClose,
  onToggleSuggestPrompt,
}: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="agent-modal-overlay" onClick={onClose}>
      <div className="agent-settings-menu" onClick={(e) => e.stopPropagation()}>
        <div className="agent-settings-menu__header">
          <span className="menu-title">Settings</span>
          <button className="icon-btn-sm" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="menu-label">OPTIONS</div>
        <label className="menu-item checkbox-label">
          <input
            type="checkbox"
            checked={suggestPrompt}
            onChange={(e) => onToggleSuggestPrompt(e.target.checked)}
          />
          <span>Suggest user prompt</span>
        </label>
      </div>
    </div>
  );
}

export default SettingsModal;
