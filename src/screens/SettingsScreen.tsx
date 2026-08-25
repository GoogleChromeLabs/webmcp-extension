/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CloseIcon, ShieldIcon } from '../components/Icons.js';
import { Switch } from '../components/Switch.js';

export interface SettingsScreenProps {
  sensitiveActionAlerts: boolean;
  onToggleSensitiveActionAlerts: () => void;
  onClose: () => void;
}

/**
 * SettingsScreen Component
 * Presents settings options, currently featuring the Sensitive action alerts permission toggle.
 */
export function SettingsScreen({
  sensitiveActionAlerts,
  onToggleSensitiveActionAlerts,
  onClose,
}: SettingsScreenProps) {
  return (
    <div className="settings-view">
      <div className="settings-card">
        {/* Header */}
        <div className="settings-card__header">
          <h1 className="settings-title">Settings</h1>
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
          >
            <CloseIcon size={20} color="var(--color-blue-title)" />
          </button>
        </div>

        {/* Permissions Section */}
        <div className="settings-section">
          <h2 className="settings-section__title">Permissions</h2>

          <div className="settings-item">
            <div className="settings-item__icon">
              <ShieldIcon size={24} color="var(--color-on-surface-variant)" />
            </div>
            <div className="settings-item__content">
              <span className="settings-item__title">Sensitive action alerts</span>
              <p className="settings-item__desc">
                Get a prompt before tools make changes to your data or accounts. Some external tools may not support this.
              </p>
            </div>
            <div className="settings-item__control">
              <Switch
                checked={sensitiveActionAlerts}
                onChange={onToggleSensitiveActionAlerts}
                aria-label="Sensitive action alerts"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsScreen;
