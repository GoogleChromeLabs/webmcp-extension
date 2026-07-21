import React from 'react';
import { PlayArrowIcon, SquareStopIcon } from './Icons.jsx';

/**
 * ButtonUI Component
 * Figma Node ID: 3344:8823 ("Action Button")
 */
export function ButtonUI({
  property1 = 'Live Button',
  property2 = 'Default',
  onClick,
  className = ''
}) {
  let classNames = ['nexus-button-ui'];
  if (property2 === 'Pressed') classNames.push('nexus-button-ui--pressed');
  if (className) classNames.push(className);

  const renderIcon = () => {
    switch (property1) {
      case 'Stop Button':
        return <SquareStopIcon size={12} color="#ffffff" />;
      case 'Send Button':
      case 'Live Button':
      default:
        return <PlayArrowIcon size={14} color="#ffffff" />;
    }
  };

  return (
    <button
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={property1}
      data-node-id="3344:8823"
      data-type={property1}
      data-state={property2}
    >
      <div className="nexus-button-ui__icon-wrapper">
        {renderIcon()}
      </div>
    </button>
  );
}

export default ButtonUI;
