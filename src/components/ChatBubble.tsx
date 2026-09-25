/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TextInput, TextInputProps } from './TextInput.js';
import { Toolbar, ToolbarProps } from './Toolbar.js';
import { AttachedTab, AttachedTabProps } from './AttachedTab.js';
import {
  AllowToolPermissionCard,
  AllowToolPermissionCardProps,
} from './AllowToolPermissionCard.js';
import { VoiceActiveBar, VoiceActiveBarProps } from './VoiceActiveBar.js';

export interface ChatBubbleProps {
  showTab?: boolean;
  tabProps?: AttachedTabProps;
  textProps?: TextInputProps;
  toolbarProps?: ToolbarProps;
  permissionProps?: AllowToolPermissionCardProps | null;
  voiceProps?: VoiceActiveBarProps | null;
  className?: string;
}

/**
 * ChatBubble Component
 * Main prompt composition container featuring the attached active tab bar,
 * optional Gemini Live voice status bar, and input toolbar, or tool permission
 * prompt when sensitive actions require confirmation.
 */
export function ChatBubble({
  showTab = false,
  tabProps = {},
  textProps = {},
  toolbarProps = {},
  permissionProps = null,
  voiceProps = null,
  className = '',
}: ChatBubbleProps) {
  const classNames = ['chat-bubble'];
  if (showTab) classNames.push('chat-bubble--with-tab');
  if (voiceProps) classNames.push('chat-bubble--voice-active');
  if (permissionProps) classNames.push('chat-bubble--permission');
  if (className) classNames.push(className);

  return (
    <div className={classNames.join(' ')}>
      {showTab && <AttachedTab {...tabProps} />}
      {voiceProps && <VoiceActiveBar {...voiceProps} />}
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


