import React from 'react';
import Header from '../components/Header.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import IPHPopover from '../components/IPHPopover.jsx';
import { SymbolIcon } from '../components/Icons.jsx';

/**
 * NexusIPHScreen Component
 * WebMCP Figma Node ID: 3413:129118 ("On Page - IPH")
 * 100% Pixel-Accurate to Figma Specs
 */
export function NexusIPHScreen({ onCloseIPH, onGotItIPH }) {
  const actions = [
    { text: 'Change brightness', icon: 'brightness_5' },
    { text: 'Export pictures in different formats', icon: 'attach_file' },
    { text: 'Apply GQ style', icon: 'automation' }
  ];

  return (
    <div className="nexus-screen nexus-screen--iph" data-node-id="3413:129118">
      <Header variant="agent" />

      <main className="nexus-onpage__content">
        <div className="nexus-onpage__greeting">
          <h1 className="nexus-onpage__title">Hi there!</h1>
          <p className="nexus-onpage__subtitle">
            How can I help you with your photographs?
          </p>
        </div>

        <div className="nexus-onpage__suggestions">
          {actions.map((act, i) => (
            <button key={i} className="nexus-chip">
              <span className="nexus-chip__text">{act.text}</span>
            </button>
          ))}
        </div>
      </main>

      {/* Floating IPH Popover (Node 3413:135869) */}
      <div className="nexus-iph-wrapper">
        <IPHPopover
          stepText="1 of 2"
          title="Automate page actions"
          description="Notice tools next to page domain? Perform tasks quicker using WebMCP tools provided by the site."
          onClose={onCloseIPH}
          onNext={onGotItIPH}
        />
      </div>

      <footer className="nexus-onpage__footer">
        <ChatBubble
          tab={true}
          tabVariant="Single, With tools"
          tabProps={{
            domain: "lightroom.adobe.com",
            toolsCount: 5
          }}
          placeholder="Ask Nexus anything"
          value=""
        />
      </footer>
    </div>
  );
}

export default NexusIPHScreen;
