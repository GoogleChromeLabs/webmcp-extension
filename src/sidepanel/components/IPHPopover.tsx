/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SymbolIcon } from './Icons.js';

const TITLE = 'Available WebMCP tools';

export interface IPHPopoverProps {
  onClose?: () => void;
  onViewActions?: () => void;
  onGotIt?: () => void;
}

/**
 * IPHPopover Component
 */
export function IPHPopover({
  onClose,
  onViewActions,
  onGotIt,
}: IPHPopoverProps) {
  return (
    <div
      className="iph"
      role="region"
      aria-label={TITLE}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="iph__card">
        <button
          type="button"
          className="iph__close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <SymbolIcon name="close" size={16} color="#ffffff" />
        </button>

        <div className="iph__content">
          <h4 className="iph__title">{TITLE}</h4>
          <p className="iph__desc">
            Available WebMCP tools enables AI agents to perform actions quicker. You can always review
            available tools on a page.
          </p>
          <a
            href="#"
            className="iph__link"
            onClick={(e) => {
              e.preventDefault();
              if (onViewActions) onViewActions();
            }}
          >
            Learn more about tools and WebMCP.
          </a>
        </div>

        <div className="iph__footer">
          {onViewActions && (
            <button
              type="button"
              className="iph__btn iph__btn--secondary"
              onClick={onViewActions}
            >
              View actions
            </button>
          )}
          <button
            type="button"
            className="iph__btn iph__btn--primary"
            onClick={onGotIt}
          >
            Got it
          </button>
        </div>
      </div>
      <div className="iph__pointer" aria-hidden="true"></div>
    </div>
  );
}
