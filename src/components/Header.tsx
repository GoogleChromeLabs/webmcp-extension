/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EditSquareIcon, SettingsIcon } from './Icons.jsx';

export interface HeaderProps {
  title?: string;
  iconColor?: string;
  onEdit?: () => void;
  onSettings?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Header Component
 * Renders header action controls: Start New Chat and Settings aligned to the right.
 */
export function Header({
  iconColor = '#012c6f',
  onEdit,
  onSettings,
  className = '',
}: HeaderProps) {
  return (
    <header className={`agent-header ${className}`}>
      {/* Action Controls aligned to the right */}
      <div className="agent-header__actions">
        {/* 1. Start New Chat */}
        <button
          type="button"
          className="agent-header__action-btn"
          onClick={onEdit}
          title="Start new chat"
          aria-label="Start new chat"
        >
          <EditSquareIcon size={20} color={iconColor} />
        </button>

        {/* 2. Settings */}
        <button
          type="button"
          className="agent-header__action-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon size={20} color={iconColor} />
        </button>
      </div>
    </header>
  );
}

export default Header;
