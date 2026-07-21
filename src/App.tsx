/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header.jsx';
import ChatBubble from './components/ChatBubble.jsx';
import WebMCPToolsDialogue from './components/WebMCPToolsDialogue.jsx';
import IPHPopover from './components/IPHPopover.jsx';
import ConsentScreen from './screens/ConsentScreen.jsx';
import ToolsInspectorScreen from './screens/ToolsInspectorScreen.js';
import SettingsModal from './screens/SettingsModal.jsx';
import MarkdownText from './components/MarkdownText.jsx';
import ActionLog from './components/ActionLog.js';

import { PROVIDERS } from './providers.js';
import { useTheme } from './hooks/useTheme.js';
import { useActiveTabTools } from './hooks/useActiveTabTools.js';
import { useAgentSession } from './hooks/useAgentSession.js';
import { executeTabTool } from './services/extensionBridge.js';
import { ProviderKey } from './types/index.js';

export function App() {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<'chat' | 'tools'>('chat');
  const [showConsent, setShowConsent] = useState<boolean>(
    (localStorage.agentConsent ?? localStorage.agentConsent) !== 'true'
  );
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showToolsDialogue, setShowToolsDialogue] = useState<boolean>(false);
  const [showIPHPopover, setShowIPHPopover] = useState<boolean>(false);
  const [showModelDropdown, setShowModelDropdown] = useState<boolean>(false);
  const [contextDetached, setContextDetached] = useState<boolean>(false);

  // Custom Hooks
  useTheme();
  const { tools, toolsRef, domain, favicon, statusMsg } = useActiveTabTools();
  const {
    provider,
    setProvider,
    model,
    setModel,
    apiKey,
    suggestPrompt,
    setSuggestPrompt,
    userPrompt,
    setUserPrompt,
    messages,
    busy,
    activityLog,
    setActivityLog,
    handleSendPrompt,
    handleReset,
    handlePromptApiKey,
  } = useAgentSession(toolsRef);

  const chatStreamEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll chat to bottom on new messages
  useEffect(() => {
    setTimeout(() => {
      chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [messages, busy]);

  // Derive dynamic welcome subtitle topic based on active domain
  const domainTopic = domain && domain !== 'New Tab' ? domain : 'your tasks';

  // Model switching logic
  const handleSelectModel = (newProvider: ProviderKey, newModel: string) => {
    if (newProvider !== provider) {
      setProvider(newProvider);
    }
    setModel(newModel);
  };

  // Welcome Action Chips
  const welcomeActionChips =
    tools.length > 0 && domain && !contextDetached
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

  return (
    <div className="agent-screen-shell">
      {/* Top Extension Header */}
      <Header
        title="AGENT"
        onEdit={handleReset}
        onSettings={() => setShowSettings(true)}
        onClose={() => window.close()}
      />

      {/* Error / Status Notice */}
      {statusMsg && <div id="status">{statusMsg}</div>}

      <main>
        {showConsent ? (
          <ConsentScreen
            onGotIt={() => {
              localStorage.agentConsent = 'true';
              setShowConsent(false);
            }}
            onClose={() => {
              localStorage.agentConsent = 'true';
              setShowConsent(false);
            }}
          />
        ) : activeTab === 'chat' ? (
          <section className="view chat-view">
            {/* Chat Stream Area */}
            <div id="chatStream">
              {messages.length === 0 && (
                <div id="welcomeCard" className="welcome-card">
                  <h1 className="welcome-title">Hi there!</h1>
                  <p className="welcome-subtitle">
                    {tools.length > 0 && !contextDetached
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
                            activityLogs={activityLog}
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
                      status={activityLog.length === 0 ? 'initiation' : 'running'}
                      activityLogs={activityLog}
                    />
                  )}

                  <div ref={chatStreamEndRef} />
                </div>
              )}
            </div>

            {/* Missing API Key Notice Banner */}
            {!apiKey && (
              <div id="keyNotice" className="key-notice">
                <span>No {PROVIDERS[provider].label} API key set.</span>
                <button className="btn ghost small" onClick={() => handlePromptApiKey(provider)}>
                  Set API key
                </button>
              </div>
            )}

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
                    onOpenDetails={() => {
                      setShowToolsDialogue(false);
                      setActiveTab('tools');
                    }}
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
                tab={!contextDetached && Boolean(domain && domain !== 'New Tab')}
                tabProps={{
                  property1: 'Single',
                  property2: tools.length > 0 ? 'With tools' : 'No tools',
                  domain: domain || 'New Tab',
                  faviconUrl: favicon,
                  toolsCountLabel: `${tools.length} tools`,
                  onClose: () => setContextDetached(true),
                  onToggleExpand: handleBadgeClick,
                }}
                textProps={{
                  value: userPrompt,
                  placeholder: 'Ask Agent anything',
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setUserPrompt(e.target.value),
                  onSubmit: handleSendPrompt,
                }}
                toolbarProps={{
                  selectedProvider: provider,
                  selectedModel: model,
                  isModelPickerOpen: showModelDropdown,
                  onModelPickerToggle: () => setShowModelDropdown(!showModelDropdown),
                  onSelectModel: handleSelectModel,
                  onCloseModelPicker: () => setShowModelDropdown(false),
                  actionButtonType: busy ? 'Stop Button' : userPrompt.trim() ? 'Send Button' : 'Live Button',
                  actionButtonState: 'Default',
                  onActionButtonClick: handleSendPrompt,
                  onAttach: () => setContextDetached(false),
                }}
              />
            </footer>
          </section>
        ) : (
          <ToolsInspectorScreen
            tools={tools}
            activityLog={activityLog}
            domain={domain}
            onBackToChat={() => setActiveTab('chat')}
            onClearActivity={() => setActivityLog([])}
            onExecuteTool={executeTabTool}
          />
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          isOpen={showSettings}
          apiKeys={{
            gemini: localStorage.apiKey_gemini || '',
            openai: localStorage.apiKey_openai || '',
            anthropic: localStorage.apiKey_anthropic || '',
          }}
          suggestPrompt={suggestPrompt}
          onClose={() => setShowSettings(false)}
          onSetApiKey={handlePromptApiKey}
          onToggleSuggestPrompt={(checked: boolean) => {
            setSuggestPrompt(checked);
            localStorage.suggestUserPrompt = String(checked);
          }}
        />
      )}
    </div>
  );
}

export default App;
