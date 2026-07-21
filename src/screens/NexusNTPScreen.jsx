import React from 'react';
import Header from '../components/Header.jsx';
import ChatBubble from '../components/ChatBubble.jsx';

/**
 * NexusNTPScreen Component
 * WebMCP Figma Node ID: 3413:128421 ("NTP")
 * 100% Pixel-Accurate to Figma Specs
 */
export function NexusNTPScreen() {
  const actions = [
    { text: 'Learn more about WebMCP tools' },
    { text: 'Make your website agent ready' },
    { text: 'Read about Lighthouse audit' }
  ];

  return (
    <div className="nexus-screen nexus-screen--ntp" data-node-id="3413:128421">
      <Header variant="agent" />

      <main className="nexus-ntp__content">
        <div className="nexus-ntp__greeting">
          <h1 className="nexus-ntp__title">Hi there!</h1>
          <p className="nexus-ntp__subtitle">How can I help you?</p>
        </div>

        <div className="nexus-ntp__suggestions">
          {actions.map((act, i) => (
            <button key={i} className="nexus-chip">
              <span className="nexus-chip__text">{act.text}</span>
            </button>
          ))}
        </div>
      </main>

      <footer className="nexus-ntp__footer">
        <ChatBubble
          tab={false}
          placeholder="Ask Nexus anything"
          value=""
        />
      </footer>
    </div>
  );
}

export default NexusNTPScreen;
