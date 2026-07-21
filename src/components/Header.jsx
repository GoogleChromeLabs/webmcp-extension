import React from 'react';
import { AtomLogo, EditSquareIcon, SettingsIcon, CloseIcon, MoreVertIcon } from './Icons.jsx';

/**
 * Header Component
 * 100% Matching WebMCP Figma Node 3453:4113 ("header") and 3178:226463
 *
 * Props:
 * - title: Header text (default "AGENT")
 * - iconColor: Color for action icons (default "#012c6f")
 * - variant: "agent" (edit_square, settings, close) or "landing" (more_vert, settings, close)
 * - onEdit / onMore: Callback for first action icon
 * - onSettings: Callback for settings icon
 * - onClose: Callback for close icon
 */
export function Header({
  title = 'AGENT',
  iconColor = '#012c6f',
  variant = 'agent',
  onEdit,
  onMore,
  onSettings,
  onClose,
  className = ''
}) {
  const isLanding = variant === 'landing';

  return (
    <div className={`nexus-header ${className}`} data-node-id="3453:4113" data-name="header">
      {/* Brand Section */}
      <div className="nexus-header__brand" data-node-id="3453:4100" data-name="brand">
        <div className="nexus-header__logo" data-node-id="3453:4101" data-name="nexus-logo">
          <AtomLogo size={18} color="#012c6f" />
        </div>
        <h1 className="nexus-header__title" data-node-id="3453:4104">
          {title}
        </h1>
      </div>

      {/* Action Buttons (12px gap, 20px x 20px size, exact #012c6f color) */}
      <div className="nexus-header__actions" data-node-id="3453:4106" data-name="actions">
        {isLanding ? (
          <button
            className="nexus-header__action-btn"
            onClick={onMore}
            title="More options"
            aria-label="More options"
            data-node-id="3187:226650"
          >
            <MoreVertIcon size={20} color={iconColor} />
          </button>
        ) : (
          <button
            className="nexus-header__action-btn"
            onClick={onEdit}
            title="Edit"
            aria-label="Edit"
            data-node-id="3453:4107"
          >
            <EditSquareIcon size={20} color={iconColor} />
          </button>
        )}

        <button
          className="nexus-header__action-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          data-node-id="3453:4108"
        >
          <SettingsIcon size={20} color={iconColor} />
        </button>

        <button
          className="nexus-header__action-btn"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          data-node-id="3453:4109"
        >
          <CloseIcon size={20} color={iconColor} />
        </button>
      </div>
    </div>
  );
}

export default Header;
