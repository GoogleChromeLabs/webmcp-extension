/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useId, useState } from 'react';
import { CloseIcon, DeviceIcon, LiveWaveIcon, ShieldIcon } from '../components/Icons.js';
import { Switch } from '../components/Switch.js';
import { getGeminiApiKey, getLiveModel, LIVE_MODEL_ID_DEFAULT } from '../services/geminiLive.js';

export interface SettingsScreenProps {
  sensitiveActionAlerts: boolean;
  onToggleSensitiveActionAlerts: () => void;
  onDeviceModel: boolean;
  onToggleOnDeviceModel: () => void;
  onDeviceModelSupported: boolean;
  /** A response is being generated, which the model must not change under. */
  responseInProgress?: boolean;
  onClose: () => void;
}

/**
 * SettingsScreen Component
 * Presents settings options, including Sensitive action alerts, On-device model,
 * and direct in-extension Gemini API Key / Live Model configuration for serverless operation.
 */
export function SettingsScreen({
  sensitiveActionAlerts,
  onToggleSensitiveActionAlerts,
  onDeviceModel,
  onToggleOnDeviceModel,
  onDeviceModelSupported,
  responseInProgress = false,
  onClose,
}: SettingsScreenProps) {
  const alertsDescId = useId();
  const modelDescId = useId();
  const modelLockedId = useId();
  const geminiKeyInputId = useId();
  const geminiLiveModelInputId = useId();
  const modelLocked = onDeviceModelSupported && responseInProgress;

  const [apiKeyInput, setApiKeyInput] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem('geminiApiKey') || '';
    } catch {
      return '';
    }
  });
  const [liveModelInput, setLiveModelInput] = useState<string>(() => getLiveModel());
  const hasBuildEnvKey = Boolean((process.env.WEBMCP_GEMINI_API_KEY || '').trim());
  const effectiveKeyPresent = Boolean(getGeminiApiKey());

  const handleApiKeyChange = (value: string) => {
    setApiKeyInput(value);
    try {
      const trimmed = value.trim();
      if (trimmed) {
        globalThis.localStorage?.setItem('geminiApiKey', trimmed);
      } else {
        globalThis.localStorage?.removeItem('geminiApiKey');
      }
    } catch {
      // ignore storage write errors
    }
  };

  const handleLiveModelChange = (value: string) => {
    setLiveModelInput(value);
    try {
      const trimmed = value.trim();
      if (trimmed) {
        globalThis.localStorage?.setItem('geminiLiveModel', trimmed);
      } else {
        globalThis.localStorage?.removeItem('geminiLiveModel');
      }
    } catch {
      // ignore storage write errors
    }
  };

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
              <p id={alertsDescId} className="settings-item__desc">
                Get a prompt before tools make changes to your data or accounts. Some external tools may not support this.
              </p>
            </div>
            <div className="settings-item__control">
              <Switch
                checked={sensitiveActionAlerts}
                onChange={onToggleSensitiveActionAlerts}
                aria-label="Sensitive action alerts"
                aria-describedby={alertsDescId}
              />
            </div>
          </div>
        </div>

        {/* Model Section */}
        <div className="settings-section">
          <h2 className="settings-section__title">Model</h2>

          <div className="settings-item">
            <div className="settings-item__icon">
              <DeviceIcon size={24} color="var(--color-on-surface-variant)" />
            </div>
            <div className="settings-item__content">
              <span className="settings-item__title">On-device model</span>
              <p id={modelDescId} className="settings-item__desc">
                {onDeviceModelSupported
                  ? 'Run the model in your browser with the Prompt API, instead of sending prompts and page data to the backend server. No API key needed.'
                  : 'Unavailable: this browser does not expose the Prompt API. Prompts go to the backend server or direct Gemini API.'}
              </p>
              {modelLocked && (
                <p id={modelLockedId} className="settings-item__desc">
                  Can be changed once the current response has finished.
                </p>
              )}
            </div>
            <div className="settings-item__control">
              <Switch
                checked={onDeviceModel}
                onChange={onToggleOnDeviceModel}
                disabled={!onDeviceModelSupported || responseInProgress}
                aria-label="On-device model"
                aria-describedby={modelLocked ? `${modelDescId} ${modelLockedId}` : modelDescId}
              />
            </div>
          </div>

          <div className="settings-item settings-item--stacked">
            <div className="settings-item__icon">
              <LiveWaveIcon size={22} color="var(--color-on-surface-variant)" />
            </div>
            <div className="settings-item__content">
              <span className="settings-item__title">Gemini API &amp; Live Voice (Serverless)</span>
              <p className="settings-item__desc">
                Connects directly to Gemini from the extension (mints ephemeral <code>v1beta/auth_tokens</code> for{' '}
                <code>{LIVE_MODEL_ID_DEFAULT}</code>) with no local server required.
              </p>
              <div className="settings-field-group">
                <label htmlFor={geminiKeyInputId} className="settings-field-label">
                  Gemini API key {effectiveKeyPresent ? '(Configured)' : '(Not set)'}
                </label>
                <input
                  id={geminiKeyInputId}
                  type="password"
                  className="settings-text-input"
                  value={apiKeyInput}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={
                    hasBuildEnvKey
                      ? 'Using GEMINI_API_KEY from .env (enter to override)'
                      : 'AIzaSy...'
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="settings-field-group">
                <label htmlFor={geminiLiveModelInputId} className="settings-field-label">
                  Gemini Live voice model
                </label>
                <input
                  id={geminiLiveModelInputId}
                  type="text"
                  className="settings-text-input"
                  value={liveModelInput}
                  onChange={(e) => handleLiveModelChange(e.target.value)}
                  placeholder={LIVE_MODEL_ID_DEFAULT}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsScreen;

