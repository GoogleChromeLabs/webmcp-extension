/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutomationIcon, CloseIcon, SymbolIcon } from './Icons.js';

export interface WebMCPToolsDialogueProps {
  domain?: string;
  toolsCount?: number;
  toolsList?: string[];
  onClose?: () => void;
  className?: string;
}

/**
 * WebMCPToolsDialogue Component
 */
export function WebMCPToolsDialogue({
  domain = 'Active Tab',
  toolsCount = 0,
  toolsList = [],
  onClose,
  className = '',
}: WebMCPToolsDialogueProps) {
  return (
    <div
      className={`tools-dialogue ${className}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="webmcp-tools-dialog-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {/* Header Row */}
      <div className="tools-dialogue__header">
        <div className="tools-dialogue__header-left">
          <div className="tools-dialogue__icon-bg">
            <AutomationIcon size={16} color="#0842a0" />
          </div>
          <div className="tools-dialogue__titles">
            <h3 id="webmcp-tools-dialog-title" className="tools-dialogue__title">Available WebMCP tools</h3>
            <p className="tools-dialogue__subtitle">{domain} • {toolsCount} tools</p>
          </div>
        </div>
        <button
          type="button"
          className="tools-dialogue__close-btn"
          onClick={onClose}
          title="Close dialogue"
          aria-label="Close dialogue"
        >
          <CloseIcon size={18} color="#474747" />
        </button>
      </div>

      <div className="tools-dialogue__divider" />

      {/* Description Row */}
      <div className="tools-dialogue__desc-row">
        <p className="tools-dialogue__desc-text">
          Available WebMCP tools on this page that enables AI agents to complete following tasks quicker.{' '}
          <a href="#" className="tools-dialogue__link" onClick={(e) => e.preventDefault()}>
            Learn more about tools and WebMCP
          </a>
        </p>
      </div>

      <div className="tools-dialogue__divider" />

      {/* Tools List Row */}
      <div className="tools-dialogue__list-row">
        <div className="tools-dialogue__list">
          {toolsList.map((toolName, idx) => (
            <div key={`${toolName}-${idx}`} className="tools-dialogue__item">
              <SymbolIcon name="check" size={16} color="#1c1917" />
              <span className="tools-dialogue__item-name">{toolName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WebMCPToolsDialogue;
