/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SettingsModal Component
 * Configuration dialog for Agent Options.
 * Renders as a floating modal popup overlay.
 */
export function SettingsModal({
  isOpen,
  onClose,
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

        <div className="menu-item" style={{ color: 'var(--agent-color-on-surface-variant, #444746)', padding: '12px 16px' }}>
          Coming soon!
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
