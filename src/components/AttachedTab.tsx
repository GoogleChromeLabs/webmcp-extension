/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ActionsChip } from './ActionsChip.jsx';
import { Favicon, FaviconStack } from './Favicon.js';
import { CloseIcon, ArrowDownIcon, ArrowUpIcon } from './Icons.jsx';

export interface AttachedTabProps {
  property1?: 'Single' | 'Multiple';
  property2?: 'No tools' | 'With tools' | 'With tools closed' | 'With tools open';
  domain?: string;
  faviconUrl?: string;
  toolsCountLabel?: string;
  onClose?: () => void;
  onToggleExpand?: () => void;
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
  onClose,
  onToggleExpand,
  className = '',
}: AttachedTabProps) {
  const isMultiple = property1 === 'Multiple';
  const isOpen = property2 === 'With tools open';
  const hasTools = property2 === 'With tools' || property2 === 'With tools closed' || property2 === 'With tools open';

  const classNames = ['attached-tab'];
  if (isMultiple) classNames.push('attached-tab--multiple');
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
        {/* Left Section: Favicon(s) + Meta Domain + ActionsChip */}
        <div className="attached-tab__left-group">
          <div className="attached-tab__left">
            {isMultiple ? (
              <FaviconStack items={faviconUrl ? [{ src: faviconUrl }] : []} />
            ) : (
              <Favicon customSrc={faviconUrl} />
            )}
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

        {/* Right Section: Chevron or Close Button */}
        <div className="attached-tab__right">
          {isMultiple ? (
            <button
              className="attached-tab__chevron-btn"
              onClick={onToggleExpand}
              title={isOpen ? 'Collapse tabs' : 'Expand tabs'}
            >
              {isOpen ? <ArrowUpIcon size={16} color="#444746" /> : <ArrowDownIcon size={16} color="#444746" />}
            </button>
          ) : (
            <button
              className="attached-tab__close-btn"
              onClick={onClose}
              title="Close tab"
            >
              <CloseIcon size={20} color="#444746" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AttachedTab;
