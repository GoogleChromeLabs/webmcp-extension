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
      className={`cdds-symbol material-symbols-outlined ${className}`.trim()}
      style={{
        fontFamily: "'Material Symbols Outlined', 'Google Symbols', sans-serif",
        fontSize: typeof size === 'number' ? `${size}px` : size,
        color: color,
        lineHeight: 1,
        display: 'inline-block',
        whiteSpace: 'nowrap',
        fontVariationSettings: `'FILL' ${fill}, 'GRAD' 0, 'opsz' 20, 'wght' ${weight}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}

export interface LogoProps {
  size?: number;
  color?: string;
  className?: string;
}

export type IconProp = Omit<SymbolIconProps, 'name'>;

export const MicIcon = (p: IconProp) => <SymbolIcon name="mic" fill={1} size={20} {...p} />;
export const SendIcon = (p: IconProp) => <SymbolIcon name="send" fill={1} size={20} {...p} />;
export const StopIcon = (p: IconProp) => <SymbolIcon name="stop" fill={1} size={20} {...p} />;
export const AttachFileIcon = (p: IconProp) => <SymbolIcon name="attach_file" size={20} {...p} />;
export const AutomationIcon = (p: IconProp) => <SymbolIcon name="automation" size={16} {...p} />;
export const CloseIcon = (p: IconProp) => <SymbolIcon name="close" size={20} {...p} />;
export const EditSquareIcon = (p: IconProp) => <SymbolIcon name="edit_square" size={20} {...p} />;
export const SettingsIcon = (p: IconProp) => <SymbolIcon name="settings" size={20} {...p} />;
export const MoreVertIcon = (p: IconProp) => <SymbolIcon name="more_vert" size={20} {...p} />;
export const ArrowDownIcon = (p: IconProp) => (
  <SymbolIcon name="keyboard_arrow_down" size={16} {...p} />
);
export const ArrowUpIcon = (p: IconProp) => (
  <SymbolIcon name="keyboard_arrow_up" size={16} {...p} />
);
export const ArrowDropUpIcon = (p: IconProp) => (
  <SymbolIcon name="arrow_drop_up" size={16} {...p} />
);
export const KeyboardArrowDownIcon = ArrowDownIcon;
export const KeyboardArrowUpIcon = ArrowUpIcon;

export function PlayArrowIcon({ size = 14, color = 'currentColor', className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block' }}
    >
      <path
        d="M4 2.5L10.5 7L4 11.5"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SquareStopIcon({ size = 12, color = 'currentColor', className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block' }}
    >
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill={color} />
    </svg>
  );
}

export default SymbolIcon;
