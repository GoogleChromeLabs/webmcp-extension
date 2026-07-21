import React from 'react';

/**
 * Foundation Symbol Icon Wrapper
 */
export function SymbolIcon({ name, size = 20, color = 'currentColor', fill = 0, weight = 400, className = '', style = {} }) {
  return (
    <span
      className={`cdds-symbol ${className}`}
      style={{
        fontFamily: "'Google Symbols', sans-serif",
        fontSize: typeof size === 'number' ? `${size}px` : size,
        color: color,
        lineHeight: 1,
        display: 'inline-block',
        whiteSpace: 'nowrap',
        fontVariationSettings: `'FILL' ${fill}, 'GRAD' 0, 'ROND' 50, 'wght' ${weight}`,
        ...style
      }}
    >
      {name}
    </span>
  );
}

// Named Symbol Exports
export const MicIcon = (p) => <SymbolIcon name="mic" fill={1} {...p} />;
export const StopIcon = (p) => <SymbolIcon name="stop" fill={1} {...p} />;
export const AttachFileIcon = (p) => <SymbolIcon name="attach_file" {...p} />;
export const AutomationIcon = (p) => <SymbolIcon name="automation" {...p} />;
export const CloseIcon = (p) => <SymbolIcon name="close" {...p} />;
export const ArrowDownIcon = (p) => <SymbolIcon name="keyboard_arrow_down" {...p} />;
export const ArrowUpIcon = (p) => <SymbolIcon name="keyboard_arrow_up" {...p} />;
export const ArrowDropUpIcon = (p) => <SymbolIcon name="arrow_drop_up" {...p} />;
export const EditSquareIcon = (p) => <SymbolIcon name="edit_square" {...p} />;
export const SettingsIcon = (p) => <SymbolIcon name="settings" {...p} />;
