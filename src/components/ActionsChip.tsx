/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutomationIcon } from './Icons.js';

export interface ActionsChipProps {
  state?: 'Closed' | 'Hover' | 'Pressed';
  label?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * ActionsChip Component
 * Interactive chip showing WebMCP tools count. Expands on hover into a pill.
 */
export function ActionsChip({
  state: stateProp = 'Closed',
  label = '5 tools',
  onClick,
  className = '',
}: ActionsChipProps) {
  const isClosed = stateProp === 'Closed';

  const classNames = [
    'actions-chip',
    'actions-chip--enabled',
    `actions-chip--${stateProp.toLowerCase()}`,
  ];
  if (className) classNames.push(className);

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      title={isClosed ? label : undefined}
      aria-label={label}
    >
      <div className="actions-chip__icon-wrapper">
        <AutomationIcon size={16} color="currentColor" />
      </div>

      <span className="actions-chip__label">{label}</span>
    </button>
  );
}

