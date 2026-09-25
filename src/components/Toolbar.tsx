/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ButtonUI, ButtonVariant } from './ButtonUI.js';
import { SettingsIcon } from './Icons.js';

export interface ToolbarProps {
  actionVariant?: ButtonVariant;
  onActionClick?: () => void;
  onSettingsClick?: () => void;
  voiceActive?: boolean;
  className?: string;
}

/**
 * Toolbar Component
 * Toolbar footer inside the prompt composer.
 */
export function Toolbar({
  actionVariant = 'live',
  onActionClick,
  onSettingsClick,
  voiceActive = false,
  className = '',
}: ToolbarProps) {
  return (
    <div className={`toolbar ${className}`}>
      {onSettingsClick && (
        <button
          type="button"
          className="toolbar__settings-btn"
          onClick={onSettingsClick}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon size={20} color="var(--color-on-surface-variant)" />
        </button>
      )}
      <ButtonUI
        variant={actionVariant}
        pressed={voiceActive && actionVariant === 'live'}
        aria-label={
          actionVariant === 'live'
            ? voiceActive
              ? 'Stop voice mode'
              : 'Start Gemini Live voice mode'
            : actionVariant
        }
        aria-pressed={actionVariant === 'live' ? voiceActive : undefined}
        title={
          actionVariant === 'live'
            ? voiceActive
              ? 'Stop voice mode'
              : 'Gemini Live voice mode'
            : undefined
        }
        onClick={onActionClick}
      />
    </div>
  );
}



