/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useId } from 'react';
import { ArrowDownIcon, ArrowUpIcon, AtomLogo } from './Icons.js';
import { ActivityEntry } from '../types/index.js';

export interface ActionLogProps {
  status: 'initiation' | 'running' | 'completed' | 'permission';
  statusText?: string;
  activityLogs?: ActivityEntry[];
  defaultOpen?: boolean;
  /** Keeps the log in the page, but out of sight and out of the accessibility tree. */
  hidden?: boolean;
}

/**
 * Format activity/tool name into human readable label
 */
export function formatLogLabel(name: string): string {
  if (!name) return 'Thinking...';
  const clean = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function ActionLog({
  status,
  statusText,
  activityLogs = [],
  defaultOpen,
  hidden,
}: ActionLogProps) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen ?? (status !== 'completed'));
  const contentId = useId();

  // Determine status label
  let headerLabel = statusText;
  if (!headerLabel) {
    if (status === 'initiation') {
      headerLabel = 'Just a sec...';
    } else if (status === 'running') {
      const activeEntry = activityLogs[0];
      headerLabel = activeEntry
        ? `${formatLogLabel(activeEntry.name)}...`
        : 'Thinking...';
    } else if (status === 'permission') {
      headerLabel = 'Waiting for permission';
    } else if (status === 'completed') {
      headerLabel = 'Show thinking';
    }
  }

  // Determine status icon on left of header
  const renderStatusIcon = () => {
    if (status === 'initiation' || status === 'running') {
      return <span className="action-log__dots" aria-hidden="true">• •</span>;
    }
    return <AtomLogo size={16} color="#0b57d0" />;
  };

  // Reverse activity logs for display so earliest step is top
  const displayLogs = useMemo(() => [...activityLogs].reverse(), [activityLogs]);

  return (
    <div className="action-log" hidden={hidden}>
      {/* Header Row */}
      <button
        type="button"
        className="action-log__header"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="action-log__title-group">
          <div className="action-log__icon-wrapper">{renderStatusIcon()}</div>
          <span className="action-log__label">{headerLabel}</span>
        </div>
        <div className="action-log__chevron" aria-hidden="true">
          {isOpen ? <ArrowUpIcon size={16} /> : <ArrowDownIcon size={16} />}
        </div>
      </button>

      {/* Expanded Details */}
      {isOpen && (
        <div id={contentId} className="action-log__content">
          {/* Activity / Task Trajectory Logs */}
          <div className="action-log__items">
            {displayLogs.length > 0 ? (
              displayLogs.map((entry) => (
                <div key={entry.id} className="action-log__item">
                  <div className="action-log__item-icon">
                    {entry.done ? (
                      <span className="action-log__item-check">✓</span>
                    ) : (
                      <span className="action-log__item-circle" />
                    )}
                  </div>
                  <span className="action-log__item-label">
                    {formatLogLabel(entry.name)}
                  </span>
                </div>
              ))
            ) : (
              <div className="action-log__item">
                <div className="action-log__item-icon">
                  {status === 'completed' ? (
                    <span className="action-log__item-check">✓</span>
                  ) : (
                    <span className="action-log__item-circle" />
                  )}
                </div>
                <span className="action-log__item-label">
                  {status === 'completed' ? 'Thinking process completed' : 'Thinking...'}
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
