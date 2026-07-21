/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CloseIcon } from './Icons.js';

export interface IphAgentProps {
  title?: string;
  description?: string;
  linkText?: string;
  onViewActions?: () => void;
  onGotIt?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * IphAgent Component
 */
export function IphAgent({
  title = 'Available WebMCP tools',
  description = 'Available WebMCP tools enables AI agents to perform actions quicker. You can always review available tools on a page.',
  linkText = 'Learn more about tools and WebMCP.',
  onViewActions,
  onGotIt,
  onClose,
  className = '',
}: IphAgentProps) {
  return (
    <div className={`iph ${className}`}>
      {/* Dark Navy Card */}
      <div className="iph__card">
        {/* Close Button */}
        <button
          className="iph__close-btn"
          onClick={onClose}
          title="Close"
        >
          <CloseIcon size={16} color="#ffffff" />
        </button>

        {/* Content Area */}
        <div className="iph__content">
          <h3 className="iph__title">{title}</h3>
          <p className="iph__desc">{description}</p>
          <a
            href="#"
            className="iph__link"
            onClick={(e) => {
              e.preventDefault();
            }}
          >
            {linkText}
          </a>
        </div>

        {/* Footer Buttons */}
        <div className="iph__footer">
          <button
            className="iph__btn iph__btn--secondary"
            onClick={onViewActions}
          >
            View actions
          </button>
          <button
            className="iph__btn iph__btn--primary"
            onClick={onGotIt || onClose}
          >
            Got it
          </button>
        </div>
      </div>

      {/* Pointer Arrow */}
      <div className="iph__pointer">
        <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 8L0 0H14L7 8Z" fill="#012C6F" />
        </svg>
      </div>
    </div>
  );
}

export default IphAgent;
