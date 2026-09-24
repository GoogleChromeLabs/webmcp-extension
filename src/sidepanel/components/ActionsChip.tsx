/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutomationIcon } from './Icons.js';

export interface ActionsChipProps {
  label: string;
  onClick?: () => void;
}

/**
 * ActionsChip Component
 * Interactive chip showing WebMCP tools count. Expands on hover into a pill.
 */
export function ActionsChip({ label, onClick }: ActionsChipProps) {
  return (
    <button
      type="button"
      className="actions-chip"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <div className="actions-chip__icon-wrapper">
        <AutomationIcon size={16} color="currentColor" />
      </div>

      <span className="actions-chip__label">{label}</span>
    </button>
  );
}
