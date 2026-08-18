/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

// Clean generic web favicon fallback SVG (globe)
const GENERIC_FAVICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%235f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

export interface FaviconProps {
  customSrc?: string;
  className?: string;
}

/**
 * Favicon Component
 * Dynamically displays tab favicon or falls back to generic web globe icon.
 */
export function Favicon({ customSrc, className = '' }: FaviconProps) {
  const [imgError, setImgError] = useState<boolean>(false);
  const src = !imgError && customSrc ? customSrc : GENERIC_FAVICON;

  return (
    <div className={`fav ${className}`}>
      <img src={src} alt="Page favicon" className="fav__img" onError={() => setImgError(true)} />
    </div>
  );
}

export default Favicon;
