/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface PulseSpinnerProps {
  step?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}

/**
 * PulseSpinner Component
 */
export function PulseSpinner({ step = 1, className = '' }: PulseSpinnerProps) {
  const stepClass = `spinner--step-${step}`;

  return (
    <div className={`spinner ${stepClass} ${className}`}>
      <span className="spinner__dot spinner__dot--1" />
      <span className="spinner__dot spinner__dot--2" />
      <span className="spinner__dot spinner__dot--3" />
      <span className="spinner__dot spinner__dot--4" />
    </div>
  );
}

export default PulseSpinner;
