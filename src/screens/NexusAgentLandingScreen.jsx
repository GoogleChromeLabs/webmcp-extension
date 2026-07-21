import React, { useState } from 'react';
import { Header } from '../components/Header.jsx';
import { AttachedTab } from '../components/AttachedTab.jsx';
import { ChatBubble } from '../components/ChatBubble.jsx';
import { SymbolIcon } from '../foundation/icons/IconSet.jsx';

/**
 * NexusAgentLandingScreen
 * Step 3: Complete screen assembled using Foundation (Step 1) and Custom Components (Step 2)
 * Figma Node ID: 3178:226462
 */
export function NexusAgentLandingScreen({
  domain = 'booking.com',
  onClose,
  onSettings,
  onEdit
}) {
  const [promptText, setPromptText] = useState('');
  const [model, setModel] = useState('Gemini');

  return (
    <div className="nexus-screen-landing" data-node-id="3178:226462">
      {/* 1. Top Header */}
      <Header
        title="Nexus Agent"
        onClose={onClose}
        onSettings={onSettings}
        onEdit={onEdit}
      />

      {/* 2. Attached Context Tab */}
      <AttachedTab
        property1="Single"
        property2="With tools"
        domain={domain}
        toolsCountLabel="Fast actions"
      />

      {/* 3. Conversation & Greeting Area */}
      <div className="nexus-screen-landing__conversation" data-node-id="3187:226852">
        <div className="nexus-screen-landing__greeting-container">
          <div>
            <h2 className="nexus-screen-landing__greeting-title">Hi there!</h2>
            <p className="nexus-screen-landing__greeting-subtitle">
              I've read this page. What would you like to know?
            </p>
          </div>

          {/* Quick Capability Chips */}
          <div className="nexus-screen-landing__capability-chips">
            <button className="nexus-capability-chip" onClick={() => setPromptText('Summarise page')}>
              <SymbolIcon name="bolt" size={16} color="#0b57d0" />
              <span>Summarise page</span>
            </button>
            <button className="nexus-capability-chip" onClick={() => setPromptText('Find key facts')}>
              <SymbolIcon name="search" size={16} color="#0b57d0" />
              <span>Find key facts</span>
            </button>
            <button className="nexus-capability-chip" onClick={() => setPromptText('Write a reply')}>
              <SymbolIcon name="edit" size={16} color="#0b57d0" />
              <span>Write a reply</span>
            </button>
          </div>
        </div>

        {/* 4. Bottom Input Chat Bubble */}
        <ChatBubble
          tab={false}
          textProps={{
            value: promptText,
            placeholder: 'Ask Nexus anything',
            onChange: (e) => setPromptText(e.target.value)
          }}
          toolbarProps={{
            selectedModel: model,
            actionButtonType: promptText ? 'Send Button' : 'Live Button',
            onModelPickerClick: () => setModel(m => m === 'Gemini' ? 'Gemini Pro' : 'Gemini')
          }}
        />
      </div>
    </div>
  );
}

export default NexusAgentLandingScreen;
