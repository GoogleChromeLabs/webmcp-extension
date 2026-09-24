/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActionsChip } from './ActionsChip.js';
import { Favicon } from './Favicon.js';

export interface AttachedTabProps {
  domain: string;
  faviconUrl?: string;
  toolsCountLabel: string;
  hasTools: boolean;
  onToggleExpand?: () => void;
}

/**
 * AttachedTab Component
 * Displays the active tab domain, favicon, and interactive WebMCP tools badge.
 */
export function AttachedTab({ domain, faviconUrl, toolsCountLabel, hasTools, onToggleExpand }: AttachedTabProps) {
  return (
    <div className="attached-tab">
      <div className="attached-tab__main-row">
        <div className="attached-tab__left-group">
          <div className="attached-tab__left">
            <Favicon customSrc={faviconUrl} />
            <span className="attached-tab__meta">{domain}</span>
          </div>

          {hasTools && (
            <ActionsChip label={toolsCountLabel} onClick={onToggleExpand} />
          )}
        </div>
      </div>
    </div>
  );
}
