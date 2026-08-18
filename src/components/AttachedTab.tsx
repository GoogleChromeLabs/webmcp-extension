/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ActionsChip } from './ActionsChip';
import { Favicon } from './Favicon';
import { CloseIcon } from './Icons';

export interface AttachedTabProps {
  domain?: string;
  faviconUrl?: string;
  toolsCountLabel?: string;
  hasTools?: boolean;
  isOpen?: boolean;
  onToggleExpand?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * AttachedTab Component
 * Displays the active tab favicon, domain, and WebMCP tools count badge.
 */
export function AttachedTab({
  domain = 'Active Tab',
  faviconUrl,
  toolsCountLabel = '0 tools',
  hasTools = true,
  isOpen = false,
  onToggleExpand,
  onClose,
  className = '',
}: AttachedTabProps) {
  const classNames = ['attached-tab'];
  if (isOpen) classNames.push('attached-tab--open');
  if (className) classNames.push(className);

  return (
    <div className={classNames.join(' ')}>
      <div className="attached-tab__main-row">
        <div className="attached-tab__left-group">
          <div className="attached-tab__left">
            <Favicon customSrc={faviconUrl} />
            <span className="attached-tab__meta">{domain}</span>
          </div>

          {hasTools && (
            <ActionsChip
              state={isOpen ? 'Hover' : 'Closed'}
              label={toolsCountLabel}
              onClick={onToggleExpand}
            />
          )}
        </div>

        {onClose && (
          <button
            type="button"
            className="attached-tab__close-btn"
            onClick={onClose}
            aria-label="Detach tab"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default AttachedTab;
