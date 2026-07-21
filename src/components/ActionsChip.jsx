import React, { useState } from 'react';
import { AutomationIcon } from './Icons.jsx';

/**
 * ActionsChip Component
 * WebMCP Figma Node ID: 3385:29436 ("Actions chip")
 *
 * Prototype Behavior:
 *  - Closed (Default): 24px x 24px circle showing automation icon
 *  - Hover: Expands smoothly to show text label (e.g. "5 tools")
 *  - Pressed/Active: Solid blue pill (#0b57d0) with white text & icon
 *
 * Props:
 *  - property1: "Enabled" | "Disabled"
 *  - state: "Closed" | "Hover" | "Pressed" (Optional prop control)
 *  - label: string (default "5 tools")
 *  - disabledLabel: string (default "WebMCP disabled")
 *  - onClick: function
 */
export function ActionsChip({
  property1 = 'Enabled',
  state: stateProp,
  label = '5 tools',
  disabledLabel = 'WebMCP disabled',
  onClick,
  className = ''
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const isDisabled = property1 === 'Disabled';

  // Determine current effective state if not explicitly passed as prop
  let currentState = stateProp;
  if (!currentState) {
    if (isPressed) currentState = 'Pressed';
    else if (isHovered) currentState = 'Hover';
    else currentState = 'Closed';
  }

  const isClosed = currentState === 'Closed';
  const isPressedState = currentState === 'Pressed';
  const displayLabel = isDisabled ? disabledLabel : label;

  const classNames = [
    'nexus-actions-chip',
    `nexus-actions-chip--${isDisabled ? 'disabled' : 'enabled'}`,
    `nexus-actions-chip--${currentState.toLowerCase()}`
  ];
  if (className) classNames.push(className);

  return (
    <button
      className={classNames.join(' ')}
      data-node-id="3385:29436"
      data-name="Actions chip"
      data-property1={property1}
      data-state={currentState}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onClick={onClick}
      title={isClosed ? displayLabel : undefined}
    >
      <div className="nexus-actions-chip__icon-wrapper">
        <AutomationIcon
          size={16}
          color="currentColor"
        />
      </div>

      <span className="nexus-actions-chip__label">
        {displayLabel}
      </span>
    </button>
  );
}

export default ActionsChip;
