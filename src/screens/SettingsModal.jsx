import React from 'react';
import { PROVIDERS } from '../providers.jsx';

/**
 * SettingsModal Component
 * Configuration dialog for Gemini, OpenAI (ChatGPT), and Anthropic API keys.
 */
export function SettingsModal({
  isOpen,
  apiKeys = {},
  suggestPrompt = true,
  onClose,
  onSetApiKey,
  onToggleSuggestPrompt,
}) {
  if (!isOpen) return null;

  return (
    <div className="nexus-modal-overlay" onClick={onClose}>
      <div className="nexus-settings-menu" onClick={(e) => e.stopPropagation()}>
        <div className="nexus-settings-menu__header">
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
              <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--nexus-text-secondary)', marginBottom: '4px' }}>
                {pConfig.label}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="menu-item" style={{ flex: 1, margin: 0 }} onClick={() => onSetApiKey(pKey)}>
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
