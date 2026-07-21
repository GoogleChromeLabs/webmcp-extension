import React from 'react';
import { TextInput } from './TextInput.jsx';
import { Toolbar } from './Toolbar.jsx';
import { AttachedTab } from './AttachedTab.jsx';

/**
 * ChatBubble Component
 * WebMCP Figma Node ID: 3413:128582 ("Chat bubble")
 *
 * Properties:
 *  - tab: boolean (Tab=No [false] vs Tab=Yes [true])
 *  - tabProps: object (props for AttachedTab component)
 *  - textProps: object (props for TextInput component)
 *  - toolbarProps: object (props for Toolbar component)
 */
export function ChatBubble({
  tab = false,
  tabProps = {},
  textProps = {},
  toolbarProps = {},
  className = ''
}) {
  const isTab = Boolean(tab);
  const classNames = ['nexus-chat-bubble'];
  if (isTab) classNames.push('nexus-chat-bubble--with-tab');
  if (className) classNames.push(className);

  return (
    <div
      className={classNames.join(' ')}
      data-node-id={isTab ? '3413:128583' : '3345:1504'}
      data-name="Chat bubble"
      data-tab={isTab ? 'Yes' : 'No'}
    >
      {/* 1. Attached Tab Bar (only when tab=true / Tab=Yes) */}
      {isTab && <AttachedTab {...tabProps} />}

      {/* 2. Input Field Box (Text + Toolbar) */}
      <div
        className="nexus-chat-bubble__input-field"
        data-node-id={isTab ? '3413:128586' : '3344:8913'}
        data-name="input-field"
      >
        <TextInput {...textProps} />
        <Toolbar {...toolbarProps} />
      </div>
    </div>
  );
}

export default ChatBubble;
