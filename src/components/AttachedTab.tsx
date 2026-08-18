/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ActionsChip } from './ActionsChip';
import { Favicon } from './Favicon';
import { CloseIcon } from './Icons';

export interface AttachedTabProps {
  property1?: 'Single';
  property2?: 'No tools' | 'With tools' | 'With tools closed' | 'With tools open';
  domain?: string;
  faviconUrl?: string;
  toolsCountLabel?: string;
  onToggleExpand?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * AttachedTab Component
 */
export function AttachedTab({
  property1 = 'Single',
  property2 = 'With tools',
  domain = 'Active Tab',
  faviconUrl,
  toolsCountLabel = '0 tools',
  onToggleExpand,
  onClose,
  className = '',
}: AttachedTabProps) {
  const isOpen = property2 === 'With tools open';
  const hasTools =
    property2 === 'With tools' ||
    property2 === 'With tools closed' ||
    property2 === 'With tools open';

  const classNames = ['attached-tab'];
  if (isOpen) classNames.push('attached-tab--open');
  if (className) classNames.push(className);

  return (
    <div
      className={classNames.join(' ')}
      data-node-id="3385:29141"
      data-name="Attached tab Final"
      data-property1={property1}
      data-property2={property2}
    >
      {/* Top Main Row */}
      <div className="attached-tab__main-row">
        {/* Left Section: Favicon + Meta Domain + ActionsChip */}
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
