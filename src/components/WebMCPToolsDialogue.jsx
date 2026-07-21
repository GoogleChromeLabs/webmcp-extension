import React from 'react';
import { AutomationIcon, SettingsIcon, CloseIcon, SymbolIcon } from './Icons.jsx';

/**
 * WebMCPToolsDialogue Component
 * WebMCP Figma Node ID: 3413:136035 ("Response block/Rich response")
 *
 * Appears floating above the Attached Tab when ActionsChip is clicked!
 */
export function WebMCPToolsDialogue({
  domain = 'Lightroom.com',
  toolsCount = 5,
  toolsList = [
    'Read page',
    'Search parameters',
    'Apply parameters',
    'Export in different format',
    'Save'
  ],
  onClose,
  onOpenDetails,
  className = ''
}) {
  return (
    <div
      className={`nexus-tools-dialogue ${className}`}
      data-node-id="3413:136035"
      data-name="Response block/Rich response"
    >
      {/* Header Row */}
      <div className="nexus-tools-dialogue__header" data-node-id="3413:136036">
        <div className="nexus-tools-dialogue__header-left">
          <div className="nexus-tools-dialogue__icon-bg">
            <AutomationIcon size={16} color="#0842a0" />
          </div>
          <div className="nexus-tools-dialogue__titles">
            <h3 className="nexus-tools-dialogue__title">Available WebMCP tools</h3>
            <p className="nexus-tools-dialogue__subtitle">{domain} . {toolsCount} tools</p>
          </div>
        </div>
        <button
          className="nexus-tools-dialogue__close-btn"
          onClick={onClose}
          title="Close dialogue"
        >
          <CloseIcon size={18} color="#474747" />
        </button>
      </div>

      <div className="nexus-tools-dialogue__divider" />

      {/* Description Row */}
      <div className="nexus-tools-dialogue__desc-row" data-node-id="3413:136039">
        <p className="nexus-tools-dialogue__desc-text">
          Available WebMCP tools on this page that enables AI agents to complete following tasks quicker.{' '}
          <a href="#" className="nexus-tools-dialogue__link" onClick={(e) => e.preventDefault()}>
            Learn more about tools and WebMCP
          </a>
        </p>
      </div>

      <div className="nexus-tools-dialogue__divider" />

      {/* Tools List Row */}
      <div className="nexus-tools-dialogue__list-row" data-node-id="3413:136046">
        <div className="nexus-tools-dialogue__list">
          {toolsList.map((toolName, idx) => (
            <div key={idx} className="nexus-tools-dialogue__item">
              <SymbolIcon name="check" size={16} color="#1c1917" />
              <span className="nexus-tools-dialogue__item-name">{toolName}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="nexus-tools-dialogue__divider" />

      {/* Footer Row */}
      <div
        className="nexus-tools-dialogue__footer"
        data-node-id="3413:136070"
        onClick={onOpenDetails}
        style={{ cursor: 'pointer' }}
      >
        <div className="nexus-tools-dialogue__footer-left">
          <SettingsIcon size={20} color="#1f1f1f" />
          <span className="nexus-tools-dialogue__footer-title">Available WebMCP tools in details</span>
        </div>
        <button
          className="nexus-tools-dialogue__arrow-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetails();
          }}
          title="View in details"
        >
          <SymbolIcon name="arrow_forward" size={20} color="#1f1f1f" />
        </button>
      </div>
    </div>
  );
}

export default WebMCPToolsDialogue;
