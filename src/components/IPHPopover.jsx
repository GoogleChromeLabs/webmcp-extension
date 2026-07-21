import React from 'react';
import { SymbolIcon } from './Icons.jsx';

/**
 * IPHPopover Component
 * WebMCP Figma Node ID: 3413:135869 ("IPH")
 * 100% Pixel-Accurate to Figma Specs
 */
export function IPHPopover({
  title = "Available WebMCP tools",
  description = "Available WebMCP tools enables AI agents to perform actions quicker. You can always review available tools on a page.",
  onClose,
  onViewActions,
  onGotIt
}) {
  return (
    <div className="nexus-iph" data-node-id="3413:135869">
      <div className="nexus-iph__card">
        <button
          className="nexus-iph__close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <SymbolIcon name="close" size={16} color="#ffffff" />
        </button>

        <div className="nexus-iph__content">
          <h4 className="nexus-iph__title">{title}</h4>
          <p className="nexus-iph__desc">{description}</p>
          <a
            href="#"
            className="nexus-iph__link"
            onClick={(e) => {
              e.preventDefault();
              if (onViewActions) onViewActions();
            }}
          >
            Learn more about tools and WebMCP.
          </a>
        </div>

        <div className="nexus-iph__footer">
          {onViewActions && (
            <button
              className="nexus-iph__btn nexus-iph__btn--secondary"
              onClick={onViewActions}
            >
              View actions
            </button>
          )}
          <button
            className="nexus-iph__btn nexus-iph__btn--primary"
            onClick={onGotIt}
          >
            Got it
          </button>
        </div>
      </div>
      <div className="nexus-iph__pointer"></div>
    </div>
  );
}

export default IPHPopover;
