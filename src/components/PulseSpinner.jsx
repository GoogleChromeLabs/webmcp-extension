import React from 'react';

/**
 * PulseSpinner Component (Pulse/Spinner-Pulse-4)
 * Figma Node ID: 3346:1404
 * Props:
 *  - step: 1 | 2 | 3 | 4 | 5 | 6 (default: 1)
 *  - className: additional css classes
 */
export function PulseSpinner({ step = 1, className = '' }) {
  const stepClass = `nexus-spinner--step-${step}`;

  return (
    <div className={`nexus-spinner ${stepClass} ${className}`} data-node-id="3346:1404" data-step={step}>
      <span className="nexus-spinner__dot nexus-spinner__dot--1" />
      <span className="nexus-spinner__dot nexus-spinner__dot--2" />
      <span className="nexus-spinner__dot nexus-spinner__dot--3" />
      <span className="nexus-spinner__dot nexus-spinner__dot--4" />
    </div>
  );
}

export default PulseSpinner;
