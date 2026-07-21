/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PROVIDERS } from '../providers.js';
import { ProviderKey } from '../types/index.js';

export interface SettingsModalProps {
  isOpen: boolean;
  apiKeys?: Record<string, string>;
  suggestPrompt?: boolean;
  onClose: () => void;
  onSetApiKey: (provider: ProviderKey) => void;
  onToggleSuggestPrompt: (checked: boolean) => void;
}

/**
 * SettingsModal Component
 * Configuration dialog for Gemini, OpenAI, and Anthropic API keys.
 * Renders as a floating modal popup overlay.
 */
export function SettingsModal({
  isOpen,
  apiKeys = {},
  suggestPrompt = true,
  onClose,
  onSetApiKey,
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

        <div className="menu-label">API KEYS</div>

        {Object.entries(PROVIDERS).map(([pKey, pConfig]) => {
          const hasKey = Boolean(apiKeys[pKey]);
          return (
            <div key={pKey} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--agent-text-secondary)', marginBottom: '4px' }}>
                {pConfig.label}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="menu-item" style={{ flex: 1, margin: 0 }} onClick={() => onSetApiKey(pKey as ProviderKey)}>
                  {hasKey ? `Update ${pConfig.label} key…` : `Set ${pConfig.label} key…`}
                </button>
                <a
                  className="menu-item link"
                  style={{ margin: 0, whiteSpace: 'nowrap' }}
                  href={pConfig.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get key ↗
                </a>
              </div>
            </div>
          );
        })}

        <div className="menu-divider" />

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
