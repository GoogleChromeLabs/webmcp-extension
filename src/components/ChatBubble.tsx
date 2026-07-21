/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TextInput, TextInputProps } from './TextInput.js';
import { Toolbar, ToolbarProps } from './Toolbar.js';
import { AttachedTab, AttachedTabProps } from './AttachedTab.js';

export interface ChatBubbleProps {
  tab?: boolean;
  tabProps?: AttachedTabProps;
  textProps?: TextInputProps;
  toolbarProps?: ToolbarProps;
  className?: string;
}

/**
 * ChatBubble Component
 */
export function ChatBubble({
  tab = false,
  tabProps = {},
  textProps = {},
  toolbarProps = {},
  className = '',
}: ChatBubbleProps) {
  const isTab = Boolean(tab);
  const classNames = ['chat-bubble'];
  if (isTab) classNames.push('chat-bubble--with-tab');
  if (className) classNames.push(className);

  return (
    <div className={classNames.join(' ')}>
      {/* 1. Attached Tab Bar */}
      {isTab && <AttachedTab {...tabProps} />}

      {/* 2. Input Field Box (Text + Toolbar) */}
      <div className="chat-bubble__input-field">
        <TextInput {...textProps} />
        <Toolbar {...toolbarProps} />
      </div>
    </div>
  );
}

export default ChatBubble;
