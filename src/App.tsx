/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import ChatBubble from './components/ChatBubble';
import WebMCPToolsDialogue from './components/WebMCPToolsDialogue';
import InProductHelpPopover from './components/InProductHelpPopover';
import ConsentScreen from './screens/ConsentScreen';
import MarkdownText from './components/MarkdownText';
import ActionLog from './components/ActionLog';
import { EditSquareIcon } from './components/Icons';

import { useActiveTabTools } from './hooks/useActiveTabTools';
import { useAgentSession } from './hooks/useAgentSession';

export function App() {
  // Navigation & View State
  const [showConsent, setShowConsent] = useState<boolean>(
    () => localStorage.getItem('agentConsent') !== 'true'
  );
  const [showToolsDialogue, setShowToolsDialogue] = useState<boolean>(false);
  const [showInProductHelpPopover, setShowInProductHelpPopover] = useState<boolean>(false);

  // Custom Hooks
  const { tools, toolsRef, domain, favicon, statusMsg } = useActiveTabTools();
  const { userPrompt, setUserPrompt, messages, busy, activityLog, handleSendPrompt, handleReset } =
    useAgentSession(toolsRef);

  const chatStreamEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll chat to bottom on new messages
  useEffect(() => {
    const timer = setTimeout(() => {
      chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, busy]);

  // Derive dynamic welcome subtitle topic based on active domain
  const domainTopic = domain && domain !== 'New Tab' ? domain : 'your tasks';

  // Welcome Action Chips
  const welcomeActionChips =
    tools.length > 0 && domain
      ? tools.slice(0, 3).map((tool) => ({
          text: tool.description || tool.name,
        }))
      : [
          { text: 'Learn more about WebMCP tools' },
          { text: 'Make your website agent ready' },
          { text: 'Read about Lighthouse audit' },
        ];

  const handleBadgeClick = () => {
    if (showInProductHelpPopover) {
      setShowInProductHelpPopover(false);
      setShowToolsDialogue(true);
    } else if (showToolsDialogue) {
      setShowToolsDialogue(false);
    } else {
      setShowInProductHelpPopover(true);
    }
  };

  return (
    <div className="agent-screen-shell">
      {/* Error / Status Notice */}
      {statusMsg && <div id="status">{statusMsg}</div>}

      <main>
        {showConsent ? (
          <ConsentScreen
            onGotIt={() => {
              localStorage.setItem('agentConsent', 'true');
              setShowConsent(false);
            }}
          />
        ) : (
          <section className="view chat-view">
            {/* Chat Stream Area */}
            <div id="chatStream">
              {messages.length === 0 && (
                <div id="welcomeCard" className="welcome-card">
                  <div className="welcome-card__header">
                    <h1 className="welcome-title">Hi there!</h1>
                  </div>
                  <p className="welcome-subtitle">
                    {tools.length > 0
                      ? `How can I help you with ${domainTopic}?`
                      : 'How can I help you?'}
                  </p>

                  <div className="action-chips">
                    {welcomeActionChips.map((chip, idx) => (
                      <button
                        key={idx}
                        className="action-chip"
                        onClick={() => setUserPrompt(chip.text)}
                      >
                        <span>{chip.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat Card Area matching Figma design */}
              {messages.length > 0 && (
                <div className="chat-card">
                  <div className="chat-card__header">
                    <button
                      type="button"
                      className="chat-card__new-chat-btn"
                      onClick={handleReset}
                      title="Start new chat"
                      aria-label="Start new chat"
                    >
                      <EditSquareIcon size={20} color="#012c6f" />
                    </button>
                  </div>

                  {/* Messages and Logs */}
                  {messages.map((msg) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={msg.id} className="user-bubble">
                          {msg.text}
                        </div>
                      );
                    }

                    if (msg.role === 'ai') {
                      return (
                        <React.Fragment key={msg.id}>
                          <ActionLog status="completed" activityLogs={msg.activityLogs || []} />
                          <div className="ai-response">
                            <MarkdownText content={msg.text} />
                          </div>
                        </React.Fragment>
                      );
                    }

                    if (msg.role === 'error') {
                      return (
                        <div key={msg.id} className="msg error">
                          <div className="msg-body">{msg.text}</div>
                        </div>
                      );
                    }

                    return null;
                  })}

                  {/* Pending/Running Action Log */}
                  {busy && (
                    <ActionLog
                      status={activityLog.length === 0 ? 'initiation' : 'running'}
                      activityLogs={activityLog}
                    />
                  )}

                  <div ref={chatStreamEndRef} />
                </div>
              )}
            </div>

            {/* Bottom Floating Composer (ChatBubble) */}
            <footer className="composer-footer">
              {/* Floating WebMCP Tools Dialogue Popover */}
              {showToolsDialogue && (
                <div className="floating-popover">
                  <WebMCPToolsDialogue
                    domain={domain || 'page'}
                    toolsCount={tools.length}
                    toolsList={tools.map((t) => t.description || t.name)}
                    onClose={() => setShowToolsDialogue(false)}
                  />
                </div>
              )}

              {/* Floating InProductHelpPopover */}
              {showInProductHelpPopover && (
                <div className="floating-popover">
                  <InProductHelpPopover
                    onClose={() => setShowInProductHelpPopover(false)}
                    onViewActions={() => {
                      setShowInProductHelpPopover(false);
                      setShowToolsDialogue(true);
                    }}
                    onGotIt={() => setShowInProductHelpPopover(false)}
                  />
                </div>
              )}

              <ChatBubble
                tab={Boolean(domain && domain !== 'New Tab')}
                tabProps={{
                  hasTools: tools.length > 0,
                  isOpen: showToolsDialogue,
                  domain: domain || 'New Tab',
                  faviconUrl: favicon,
                  toolsCountLabel: `${tools.length} tools`,
                  onToggleExpand: handleBadgeClick,
                }}
                textProps={{
                  value: userPrompt,
                  placeholder: 'Ask Agent anything',
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    setUserPrompt(e.target.value),
                  onSubmit: handleSendPrompt,
                }}
                toolbarProps={{
                  actionButtonType: busy
                    ? 'Stop Button'
                    : userPrompt.trim()
                      ? 'Send Button'
                      : 'Live Button',
                  actionButtonState: 'Default',
                  onActionButtonClick: handleSendPrompt,
                }}
              />
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
