/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TextInput, type TextInputProps } from './TextInput.js';
import { Toolbar, type ToolbarProps } from './Toolbar.js';
import { AttachedTab, type AttachedTabProps } from './AttachedTab.js';
import {
  AllowToolPermissionCard,
  type AllowToolPermissionCardProps,
} from './AllowToolPermissionCard.js';

export interface ChatBubbleProps {
  showTab?: boolean;
  tabProps?: AttachedTabProps;
  textProps?: TextInputProps;
  toolbarProps?: ToolbarProps;
  permissionProps?: AllowToolPermissionCardProps | null;
}

/**
 * ChatBubble Component
 * Main prompt composition container featuring the attached active tab bar and input toolbar,
 * or tool permission prompt when sensitive actions require confirmation.
 */
export function ChatBubble({
  showTab = false,
  tabProps,
  textProps = {},
  toolbarProps = {},
  permissionProps = null,
}: ChatBubbleProps) {
  const classNames = ['chat-bubble'];
  if (showTab) classNames.push('chat-bubble--with-tab');
  if (permissionProps) classNames.push('chat-bubble--permission');

  return (
    <div className={classNames.join(' ')}>
      {showTab && tabProps && <AttachedTab {...tabProps} />}
      {permissionProps ? (
        <AllowToolPermissionCard {...permissionProps} />
      ) : (
        <div className="chat-bubble__input-field">
          <TextInput {...textProps} />
          <Toolbar {...toolbarProps} />
        </div>
      )}
    </div>
  );
}
