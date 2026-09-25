/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ButtonUI, type ButtonVariant } from './ButtonUI.js';
import { SettingsIcon } from './Icons.js';

export interface ToolbarProps {
  actionVariant?: ButtonVariant;
  onActionClick?: () => void;
  onSettingsClick?: () => void;
}

/**
 * Toolbar Component
 * Toolbar footer inside the prompt composer.
 */
export function Toolbar({
  actionVariant = 'live',
  onActionClick,
  onSettingsClick,
}: ToolbarProps) {
  return (
    <div className="toolbar">
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
        onClick={onActionClick}
      />
    </div>
  );
}
