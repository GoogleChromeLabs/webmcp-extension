/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EditSquareIcon } from './Icons.jsx';

export interface HeaderProps {
  title?: string;
  iconColor?: string;
  onEdit?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Header Component
 * Renders header action controls: Start New Chat aligned to the right.
 */
export function Header({
  iconColor = '#012c6f',
  onEdit,
  className = '',
}: HeaderProps) {
  return (
    <header className={`agent-header ${className}`}>
      {/* Action Controls aligned to the right */}
      <div className="agent-header__actions">
        {/* Start New Chat */}
        <button
          type="button"
          className="agent-header__action-btn"
          onClick={onEdit}
          title="Start new chat"
          aria-label="Start new chat"
        >
          <EditSquareIcon size={20} color={iconColor} />
        </button>
      </div>
    </header>
  );
}

export default Header;
