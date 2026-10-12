/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SymbolIcon } from './Icons.js';

export interface ToolCheckpointCardProps {
  /** Rounds of tool calls the request has run so far. */
  roundsUsed: number;
  /** The most rounds it may take if the user lets it go on. */
  maxRounds: number;
  onAllow: () => void;
  onDeny: () => void;
}

/**
 * ToolCheckpointCard Component
 * Asks once whether the agent may keep using tools. It is built from the tool
 * permission card's parts and shown in the same place, so it looks the same.
 */
export function ToolCheckpointCard({ roundsUsed, maxRounds, onAllow, onDeny }: ToolCheckpointCardProps) {
  return (
    <div
      className="tool-permission-card"
      role="alertdialog"
      aria-labelledby="checkpoint-title"
      aria-describedby="checkpoint-details"
    >
      <div className="tool-permission-card__header">
        <div className="tool-permission-card__icon-wrapper">
          <SymbolIcon name="pause_circle" size={24} color="var(--color-blue-title)" />
        </div>
        <div className="tool-permission-card__title-group">
          <h3 id="checkpoint-title" className="tool-permission-card__title">
            Keep going?
          </h3>
          <p className="tool-permission-card__subtitle">
            The agent wants to use more tools for this request.
          </p>
        </div>
      </div>

      <div id="checkpoint-details" className="tool-permission-card__box">
        <div className="tool-permission-card__tool-name-container">
          <span className="tool-permission-card__tool-name">{`Used tools ${roundsUsed} times`}</span>
        </div>
        <div className="tool-permission-card__tool-desc-container">
          <span className="tool-permission-card__tool-desc">
            {`If you continue, it can use tools up to ${maxRounds} times in total, then it stops.`}
          </span>
        </div>
      </div>

      <div className="tool-permission-card__actions">
        <button
          type="button"
          className="tool-permission-card__btn tool-permission-card__btn--deny"
          onClick={onDeny}
        >
          Stop
        </button>
        <button
          type="button"
          className="tool-permission-card__btn tool-permission-card__btn--allow"
          onClick={onAllow}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
