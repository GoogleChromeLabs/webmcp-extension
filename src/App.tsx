/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import ChatBubble from './components/ChatBubble.js';
import WebMCPToolsDialogue from './components/WebMCPToolsDialogue.js';
import IPHPopover from './components/IPHPopover.js';
import ConsentScreen from './screens/ConsentScreen.js';
import SettingsScreen from './screens/SettingsScreen.js';
import MarkdownText from './components/MarkdownText.js';
import ActionLog from './components/ActionLog.js';
import OnDeviceModelStatus from './components/OnDeviceModelStatus.js';
import { EditSquareIcon } from './components/Icons.js';

import { useActiveTabTools } from './hooks/useActiveTabTools.js';
import { useAgentSession } from './hooks/useAgentSession.js';
import { isPromptApiSupported } from './services/promptApiBackend.js';

export function App() {
  // Navigation & View State
  const [showConsent, setShowConsent] = useState(
    () => localStorage.getItem('agentConsent') !== 'true'
  );
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [sensitiveActionAlerts, setSensitiveActionAlerts] = useState<boolean>(() => {
    const saved = localStorage.getItem('sensitiveActionAlerts');
    return saved !== null ? saved === 'true' : true;
  });

  // Off unless the browser has the Prompt API, so a browser without it keeps
  // using the backend server.
  const onDeviceModelSupported = isPromptApiSupported();
  const [onDeviceModel, setOnDeviceModel] = useState<boolean>(() => {
    if (!isPromptApiSupported()) return false;
    return localStorage.getItem('onDeviceModel') === 'true';
  });

  const [showToolsDialogue, setShowToolsDialogue] = useState<boolean>(false);
  const [showIPHPopover, setShowIPHPopover] = useState<boolean>(false);

  const handleToggleSensitiveActionAlerts = () => {
    setSensitiveActionAlerts((prev) => {
      const next = !prev;
      localStorage.setItem('sensitiveActionAlerts', String(next));
      return next;
    });
  };

  // Custom Hooks
  const { tools, toolsRef, domain, favicon, statusMsg } = useActiveTabTools();
  const {
    userPrompt,
    setUserPrompt,
    messages,
    busy,
    activityLog,
    pendingPermission,
    handleSendPrompt,
    handleStop,
    handleReset,
  } = useAgentSession(toolsRef, { sensitiveActionAlerts, onDeviceModel });

  const handleToggleOnDeviceModel = () => {
    // Switching backends mid-response would pull the conversation out from
    // under the request in flight. The switch is disabled then, too.
    if (busy) return;
    setOnDeviceModel((prev) => {
      const next = !prev;
      localStorage.setItem('onDeviceModel', String(next));
      return next;
    });
  };

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
    if (showIPHPopover) {
      setShowIPHPopover(false);
      setShowToolsDialogue(true);
    } else if (showToolsDialogue) {
      setShowToolsDialogue(false);
    } else {
      setShowIPHPopover(true);
    }
  };

  const dismissConsent = () => {
    localStorage.setItem('agentConsent', 'true');
    setShowConsent(false);
  };

  return (
    <div className="agent-screen-shell">
      {/* Error / Status Notice */}
      {statusMsg && <div id="status">{statusMsg}</div>}

      {/* On-device model status, outside <main> so settings cannot unmount it mid-download */}
      {onDeviceModelSupported && <OnDeviceModelStatus />}

      <main>
        {showConsent ? (
          <ConsentScreen
            onGotIt={dismissConsent}
            onClose={dismissConsent}
          />
        ) : showSettings ? (
          <SettingsScreen
            sensitiveActionAlerts={sensitiveActionAlerts}
            onToggleSensitiveActionAlerts={handleToggleSensitiveActionAlerts}
            onDeviceModel={onDeviceModel}
            onToggleOnDeviceModel={handleToggleOnDeviceModel}
            onDeviceModelSupported={onDeviceModelSupported}
            responseInProgress={busy}
            onClose={() => setShowSettings(false)}
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
                    {welcomeActionChips.map((chip) => (
                      <button
                        key={chip.text}
                        className="action-chip"
                        onClick={() => setUserPrompt(chip.text)}
                      >
                        <span>{chip.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat Messages Card */}
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
                          <ActionLog
                            status="completed"
                            activityLogs={msg.activityLogs}
                          />
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
                      status={
                        pendingPermission
                          ? 'permission'
                          : activityLog.length === 0
                          ? 'initiation'
                          : 'running'
                      }
                      statusText={pendingPermission ? 'Waiting for permission' : undefined}
                      activityLogs={activityLog}
                    />
                  )}

                  <div ref={chatStreamEndRef} />
                </div>
              )}
            </div>

            {/* Bottom Floating Composer */}
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

              {/* Floating IPH Popover */}
              {showIPHPopover && (
                <div className="floating-popover">
                  <IPHPopover
                    onClose={() => setShowIPHPopover(false)}
                    onViewActions={() => {
                      setShowIPHPopover(false);
                      setShowToolsDialogue(true);
                    }}
                    onGotIt={() => setShowIPHPopover(false)}
                  />
                </div>
              )}

              <ChatBubble
                showTab={Boolean(domain && domain !== 'New Tab')}
                tabProps={{
                  domain: domain || 'New Tab',
                  faviconUrl: favicon,
                  hasTools: tools.length > 0,
                  toolsCountLabel: `${tools.length} tools`,
                  onToggleExpand: handleBadgeClick,
                }}
                textProps={{
                  value: userPrompt,
                  placeholder: 'Ask Agent anything',
                  onChange: (e) => setUserPrompt(e.target.value),
                  onSubmit: handleSendPrompt,
                }}
                toolbarProps={{
                  actionVariant: busy ? 'stop' : userPrompt.trim() ? 'send' : 'live',
                  onActionClick: busy ? handleStop : handleSendPrompt,
                  onSettingsClick: () => setShowSettings(true),
                }}
                permissionProps={
                  pendingPermission
                    ? {
                        toolName: pendingPermission.toolName,
                        toolDescription: pendingPermission.toolDescription,
                        onAllow: pendingPermission.allow,
                        onDeny: pendingPermission.deny,
                      }
                    : null
                }
              />
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;

