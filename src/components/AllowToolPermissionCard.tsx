/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldIcon } from './Icons.js';

export interface AllowToolPermissionCardProps {
  toolName: string;
  toolDescription?: string;
  onAllow: () => void;
  onDeny: () => void;
  className?: string;
}

/**
 * AllowToolPermissionCard Component
 * Displays user prompt before executing a non-readonly tool, allowing or denying the action.
 */
export function AllowToolPermissionCard({
  toolName,
  toolDescription,
  onAllow,
  onDeny,
  className = '',
}: AllowToolPermissionCardProps) {
  return (
    <div className={`tool-permission-card ${className}`} role="alertdialog" aria-labelledby="permission-title">
      {/* Header section with Shield Icon and Titles */}
      <div className="tool-permission-card__header">
        <div className="tool-permission-card__icon-wrapper">
          <ShieldIcon size={24} color="var(--color-blue-title)" />
        </div>
        <div className="tool-permission-card__title-group">
          <h3 id="permission-title" className="tool-permission-card__title">
            Allow tool actions
          </h3>
          <p className="tool-permission-card__subtitle">
            Let this tool complete task for you
          </p>
        </div>
      </div>

      {/* Tool details box (1 tool display) */}
      <div className="tool-permission-card__box">
        <div className="tool-permission-card__tool-name-container">
          <span className="tool-permission-card__tool-name">{toolName}</span>
        </div>
        <div className="tool-permission-card__tool-desc-container">
          <span className="tool-permission-card__tool-desc">
            {toolDescription || 'No description provided for this tool.'}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="tool-permission-card__actions">
        <button
          type="button"
          className="tool-permission-card__btn tool-permission-card__btn--deny"
          onClick={onDeny}
        >
          Don’t allow
        </button>
        <button
          type="button"
          className="tool-permission-card__btn tool-permission-card__btn--allow"
          onClick={onAllow}
        >
          Allow
        </button>
      </div>
    </div>
  );
}

export default AllowToolPermissionCard;
