/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { CSSProperties } from 'react';

export interface SymbolIconProps {
  name: string;
  size?: number | string;
  color?: string;
  fill?: number;
  weight?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Foundation Symbol Icon Wrapper
 */
export function SymbolIcon({
  name,
  size = 20,
  color = 'currentColor',
  fill = 0,
  weight = 400,
  className = '',
  style = {},
}: SymbolIconProps) {
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
        ...style,
      }}
    >
      {name}
    </span>
  );
}

export type IconProp = Omit<SymbolIconProps, 'name'>;

// Named Symbol Exports
export const MicIcon = (p: IconProp) => <SymbolIcon name="mic" fill={1} {...p} />;
export const StopIcon = (p: IconProp) => <SymbolIcon name="stop" fill={1} {...p} />;
export const AttachFileIcon = (p: IconProp) => <SymbolIcon name="attach_file" {...p} />;
export const AutomationIcon = (p: IconProp) => <SymbolIcon name="automation" {...p} />;
export const CloseIcon = (p: IconProp) => <SymbolIcon name="close" {...p} />;
export const ArrowDownIcon = (p: IconProp) => <SymbolIcon name="keyboard_arrow_down" {...p} />;
export const ArrowUpIcon = (p: IconProp) => <SymbolIcon name="keyboard_arrow_up" {...p} />;
export const ArrowDropUpIcon = (p: IconProp) => <SymbolIcon name="arrow_drop_up" {...p} />;
export const EditSquareIcon = (p: IconProp) => <SymbolIcon name="edit_square" {...p} />;
export const SettingsIcon = (p: IconProp) => <SymbolIcon name="settings" {...p} />;
