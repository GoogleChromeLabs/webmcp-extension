import React from 'react';
import { CloseIcon } from './Icons.jsx';

/**
 * IphAgent Component (In-Product Help Onboarding Popover)
 * WebMCP Figma Node ID: 3505:672726 ("IPH - agent")
 *
 * Appears pointing down towards the Actions Chip on Onboarding / First Time Use!
 */
export function IphAgent({
  title = 'Available WebMCP tools',
  description = 'Available WebMCP tools enables AI agents to perform actions quicker. You can always review available tools on a page.',
  linkText = 'Learn more about tools and WebMCP.',
  onViewActions,
  onGotIt,
  onClose,
  className = ''
}) {
  return (
    <div
      className={`nexus-iph ${className}`}
      data-node-id="3505:672726"
      data-name="IPH - agent"
    >
      {/* Dark Navy Card */}
      <div className="nexus-iph__card" data-node-id="3505:672693">
        {/* Close Button */}
        <button
          className="nexus-iph__close-btn"
          onClick={onClose}
          title="Close"
        >
          <CloseIcon size={16} color="#ffffff" />
        </button>

        {/* Content Area */}
        <div className="nexus-iph__content">
          <h3 className="nexus-iph__title">{title}</h3>
          <p className="nexus-iph__desc">
            {description}
          </p>
          <a
            href="#"
            className="nexus-iph__link"
            onClick={(e) => {
              e.preventDefault();
            }}
          >
            {linkText}
          </a>
        </div>

        {/* Footer Buttons */}
        <div className="nexus-iph__footer">
          <button
            className="nexus-iph__btn nexus-iph__btn--secondary"
            onClick={onViewActions}
          >
            View actions
          </button>
          <button
            className="nexus-iph__btn nexus-iph__btn--primary"
            onClick={onGotIt || onClose}
          >
            Got it
          </button>
        </div>
      </div>

      {/* Pointer Arrow */}
      <div className="nexus-iph__pointer">
        <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 8L0 0H14L7 8Z" fill="#012C6F" />
        </svg>
      </div>
    </div>
  );
}

export default IphAgent;
