/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActionsChip } from './ActionsChip.js';
import { Favicon } from './Favicon.js';

export interface AttachedTabProps {
  domain?: string;
  faviconUrl?: string;
  toolsCountLabel?: string;
  hasTools?: boolean;
  isOpen?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

/**
 * AttachedTab Component
 * Displays the active tab domain, favicon, and interactive WebMCP tools badge.
 */
export function AttachedTab({
  domain = 'Active Tab',
  faviconUrl,
  toolsCountLabel = '0 tools',
  hasTools = true,
  isOpen = false,
  onToggleExpand,
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
      </div>
    </div>
  );
}
