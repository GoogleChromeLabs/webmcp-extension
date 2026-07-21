import React from 'react';

// Default static fallback favicons (data URLs / SVG placeholders)
const DEFAULT_FAVICONS = {
  lightroom: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23001E36" rx="3"/><text x="8" y="11" font-size="9" fill="%2331A8FF" font-family="sans-serif" text-anchor="middle" font-weight="bold">Lr</text></svg>',
  booking: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23003580" rx="3"/><text x="8" y="11" font-size="9" fill="white" font-family="sans-serif" text-anchor="middle" font-weight="bold">B.</text></svg>',
  opentable: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="%23DA3743"/><circle cx="8" cy="8" r="3" fill="white"/></svg>',
  instacart: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%2343B02A" rx="3"/><text x="8" y="11" font-size="9" fill="white" font-family="sans-serif" text-anchor="middle" font-weight="bold">i</text></svg>'
};

/**
 * Favicon Component
 * Figma Node ID: 1921:52228 / 1921:52226 / 1921:52229
 * Props:
 *  - property1: 'lightroom' | 'booking' | 'opentable' | 'instacart' (default: 'lightroom')
 *  - customSrc: string
 */
export function Favicon({ property1 = 'lightroom', customSrc, className = '' }) {
  const [imgError, setImgError] = React.useState(false);
  const src = (!imgError && customSrc) ? customSrc : (DEFAULT_FAVICONS[property1] || DEFAULT_FAVICONS.lightroom);

  return (
    <div className={`nexus-fav ${className}`} data-node-id="1921:52228" data-fav-type={property1}>
      <img
        src={src}
        alt={property1}
        className="nexus-fav__img"
        onError={() => setImgError(true)}
      />
    </div>
  );
}

/**
 * FaviconStack Component for multiple tabs representation
 */
export function FaviconStack({ items = ['booking', 'opentable', 'lightroom'], className = '' }) {
  return (
    <div className={`nexus-fav-stack ${className}`}>
      {items.slice(0, 3).map((item, index) => (
        <Favicon key={index} property1={typeof item === 'string' ? item : item.property1} customSrc={item.src} />
      ))}
    </div>
  );
}

export default Favicon;
