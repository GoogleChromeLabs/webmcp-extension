/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, AtomLogo } from './Icons.js';
import { ActivityEntry } from '../types/index.js';

export interface ActionLogProps {
  status: 'initiation' | 'running' | 'completed' | 'error';
  statusText?: string;
  activityLogs?: ActivityEntry[];
  defaultOpen?: boolean;
}

/**
 * Format activity/tool name into human readable label
 */
export function formatLogLabel(name: string): string {
  if (!name) return 'Task log in human language';
  const clean = name.replace(/[_-]+/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function ActionLog({
  status,
  statusText,
  activityLogs = [],
  defaultOpen,
}: ActionLogProps) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen ?? (status === 'completed' ? false : true));

  // Determine status label
  let headerLabel = statusText;
  if (!headerLabel) {
    if (status === 'initiation') {
      headerLabel = 'Just a sec...';
    } else if (status === 'running') {
      const activeEntry = activityLogs[0];
      headerLabel = activeEntry
        ? `${formatLogLabel(activeEntry.name)}...`
        : 'Filtering parameters for application...';
    } else if (status === 'completed') {
      headerLabel = 'Show thinking';
    } else if (status === 'error') {
      headerLabel = 'Error occurred';
    }
  }

  // Determine status icon on left of header
  const renderStatusIcon = () => {
    if (status === 'initiation' || status === 'running') {
      return <span className="action-log__dots">• •</span>;
    }
    return <AtomLogo size={16} color="#0b57d0" />;
  };

  // Reverse activity logs for display so earliest step is top
  const displayLogs = [...activityLogs].reverse();

  return (
    <div className="action-log">
      {/* Header Row */}
      <button
        type="button"
        className="action-log__header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="action-log__title-group">
          <div className="action-log__icon-wrapper">{renderStatusIcon()}</div>
          <span className="action-log__label">{headerLabel}</span>
        </div>
        <div className="action-log__chevron">
          {isOpen ? <ArrowUpIcon size={16} /> : <ArrowDownIcon size={16} />}
        </div>
      </button>

      {/* Expanded Details */}
      {isOpen && (
        <div className="action-log__content">
          {/* Activity / Task Trajectory Logs */}
          <div className="action-log__items">
            {displayLogs.length > 0 ? (
              displayLogs.map((entry) => {
                const isFinished = entry.status === 'ok' || entry.status === 'err';
                return (
                  <div key={entry.id} className="action-log__item">
                    <div className="action-log__item-icon">
                      {isFinished ? (
                        <span className="action-log__item-check">✓</span>
                      ) : (
                        <span className="action-log__item-circle" />
                      )}
                    </div>
                    <span className="action-log__item-label">
                      {formatLogLabel(entry.name)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="action-log__item">
                <div className="action-log__item-icon">
                  <span className="action-log__item-check">✓</span>
                </div>
                <span className="action-log__item-label">
                  Task log in human language
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActionLog;
