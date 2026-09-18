/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SymbolIcon } from './Icons.js';

export interface IPHPopoverProps {
  title?: string;
  description?: string;
  onClose?: () => void;
  onViewActions?: () => void;
  onGotIt?: () => void;
}

/**
 * IPHPopover Component
 */
export function IPHPopover({
  title = 'Available WebMCP tools',
  description = 'Available WebMCP tools enables AI agents to perform actions quicker. You can always review available tools on a page.',
  onClose,
  onViewActions,
  onGotIt,
}: IPHPopoverProps) {
  return (
    <div
      className="iph"
      role="region"
      aria-label={title}
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
          <h4 className="iph__title">{title}</h4>
          <p className="iph__desc">{description}</p>
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

export default IPHPopover;
