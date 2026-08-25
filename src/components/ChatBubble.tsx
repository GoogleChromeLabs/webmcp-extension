/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TextInput, TextInputProps } from './TextInput.js';
import { Toolbar, ToolbarProps } from './Toolbar.js';
import { AttachedTab, AttachedTabProps } from './AttachedTab.js';
import {
  AllowToolPermissionCard,
  AllowToolPermissionCardProps,
} from './AllowToolPermissionCard.js';

export interface ChatBubbleProps {
  showTab?: boolean;
  tab?: boolean;
  tabProps?: AttachedTabProps;
  textProps?: TextInputProps;
  toolbarProps?: ToolbarProps;
  permissionProps?: AllowToolPermissionCardProps | null;
  className?: string;
}

/**
 * ChatBubble Component
 * Main prompt composition container featuring the attached active tab bar and input toolbar,
 * or tool permission prompt when sensitive actions require confirmation.
 */
export function ChatBubble({
  showTab = false,
  tab = false,
  tabProps = {},
  textProps = {},
  toolbarProps = {},
  permissionProps = null,
  className = '',
}: ChatBubbleProps) {
  const isTab = showTab || tab;
  const classNames = ['chat-bubble'];
  if (isTab) classNames.push('chat-bubble--with-tab');
  if (permissionProps) classNames.push('chat-bubble--permission');
  if (className) classNames.push(className);

  return (
    <div className={classNames.join(' ')}>
      {isTab && <AttachedTab {...tabProps} />}
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

export default ChatBubble;

