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

/**
 * Atom Logo
 */
export function AtomLogo({ size = 18, color = '#012c6f', className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block' }}
    >
      <g id="atom">
        <path
          id="Vector"
          d="M9.7503 8.99994C9.7503 9.41415 9.41452 9.74994 9.0003 9.74994C8.58609 9.74994 8.2503 9.41415 8.2503 8.99994C8.2503 8.58572 8.58609 8.24994 9.0003 8.24994C9.41452 8.24994 9.7503 8.58572 9.7503 8.99994ZM15.1502 15.1502C16.6802 13.6277 15.1652 9.63022 11.7752 6.22522C8.37022 2.83522 4.37272 1.32022 2.85022 2.85022C1.32022 4.37272 2.83522 8.37022 6.22522 11.7752C9.63022 15.1652 13.6277 16.6802 15.1502 15.1502ZM11.7752 11.7752C15.1652 8.37022 16.6802 4.37272 15.1502 2.85022C13.6277 1.32022 9.63022 2.83522 6.22522 6.22522C2.83522 9.63022 1.32022 13.6277 2.85022 15.1502C4.37272 16.6802 8.37022 15.1652 11.7752 11.7752Z"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
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
