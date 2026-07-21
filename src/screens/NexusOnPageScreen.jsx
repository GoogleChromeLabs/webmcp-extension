import React, { useState } from 'react';
import Header from '../components/Header.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import WebMCPToolsDialogue from '../components/WebMCPToolsDialogue.jsx';
import { SymbolIcon } from '../components/Icons.jsx';

/**
 * NexusOnPageScreen Component
 * 100% Pixel-Accurate WebMCP Figma Nodes:
 * - 3413:128857 ("On page")
 * - 3413:129013 ("On Page - Too chip animation")
 * - 3413:135904 ("On Page - Action details")
 */
export function NexusOnPageScreen({
  initialShowDialogue = false,
  chipExpanded = false,
  disabledChip = false
}) {
  const [showDialogue, setShowDialogue] = useState(initialShowDialogue);
  const [chipState, setChipState] = useState(initialShowDialogue ? 'pressed' : (chipExpanded ? 'hover' : 'closed'));

  const handleChipClick = () => {
    setShowDialogue(!showDialogue);
    setChipState(showDialogue ? 'closed' : 'pressed');
  };

  const actions = [
    { text: 'Change brightness', icon: 'brightness_5' },
    { text: 'Export pictures in different formats', icon: 'attach_file' },
    { text: 'Apply GQ style', icon: 'automation' }
  ];

  return (
    <div className="nexus-screen nexus-screen--onpage" data-node-id="3413:128857">
      <Header variant="agent" />

      <main className="nexus-onpage__content">
        <div className="nexus-onpage__greeting">
          <h1 className="nexus-onpage__title">Hi there!</h1>
          <p className="nexus-onpage__subtitle">
            How can I help you with your photographs?
          </p>
        </div>

        {/* 100% Matching Suggestion Chips */}
        <div className="nexus-onpage__suggestions">
          {actions.map((act, i) => (
            <button key={i} className="nexus-chip">
              <span className="nexus-chip__text">{act.text}</span>
            </button>
          ))}
        </div>
      </main>

      {/* Floating Action Details Dialogue (Node 3413:136035) */}
      {showDialogue && (
        <div className="nexus-onpage__dialogue-wrapper">
          <WebMCPToolsDialogue
            domain="Lightroom.com"
            toolsCount={5}
            onClose={() => {
              setShowDialogue(false);
              setChipState('closed');
            }}
          />
        </div>
      )}

      {/* Bottom Floating Chat Bubble with Attached Tab */}
      <footer className="nexus-onpage__footer">
        <ChatBubble
          tab={true}
          tabVariant={disabledChip ? "Single, No tools" : "Single, With tools"}
          tabProps={{
            domain: "lightroom.adobe.com",
            toolsCount: 5,
            actionsChipProps: {
              state: chipState,
              disabled: disabledChip,
              onClick: handleChipClick
            }
          }}
          placeholder="Ask Nexus anything"
          value=""
        />
      </footer>
    </div>
  );
}

export default NexusOnPageScreen;
