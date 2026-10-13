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
import { ToolCheckpointCard, type ToolCheckpointCardProps } from './ToolCheckpointCard.js';

export interface ChatBubbleProps {
  showTab?: boolean;
  tabProps?: AttachedTabProps;
  textProps?: TextInputProps;
  toolbarProps?: ToolbarProps;
  permissionProps?: AllowToolPermissionCardProps | null;
  /** Asks whether the agent may keep using tools, in the same place as a permission prompt. */
  checkpointProps?: ToolCheckpointCardProps | null;
}

/**
 * ChatBubble Component
 * Main prompt composition container featuring the attached active tab bar and input toolbar,
 * or a prompt when the agent waits on the user: a tool permission when sensitive actions
 * require confirmation, or whether to keep using tools.
 */
export function ChatBubble({
  showTab = false,
  tabProps,
  textProps = {},
  toolbarProps = {},
  permissionProps = null,
  checkpointProps = null,
}: ChatBubbleProps) {
  const classNames = ['chat-bubble'];
  if (showTab) classNames.push('chat-bubble--with-tab');
  if (permissionProps || checkpointProps) classNames.push('chat-bubble--permission');

  return (
    <div className={classNames.join(' ')}>
      {showTab && tabProps && <AttachedTab {...tabProps} />}
      {permissionProps ? (
        <AllowToolPermissionCard {...permissionProps} />
      ) : checkpointProps ? (
        <ToolCheckpointCard {...checkpointProps} />
      ) : (
        <div className="chat-bubble__input-field">
          <TextInput {...textProps} />
          <Toolbar {...toolbarProps} />
        </div>
      )}
    </div>
  );
}
