import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.jsx';
import ChatBubble from './components/ChatBubble.jsx';
import WebMCPToolsDialogue from './components/WebMCPToolsDialogue.jsx';
import IPHPopover from './components/IPHPopover.jsx';
import SymbolIcon from './components/Icons.jsx';
import NexusConsentScreen from './screens/NexusConsentScreen.jsx';
import ToolsInspectorScreen from './screens/ToolsInspectorScreen.jsx';
import SettingsModal from './screens/SettingsModal.jsx';
import MarkdownText from './components/MarkdownText.jsx';

import { PROVIDERS, createChat, oneShot } from './providers.jsx';
import { getIframeOrigins } from '../extension/utils.js';

// Setup browser fallback for chrome extension APIs
if (!window.chrome || !window.chrome.tabs) {
  let messageListeners = [];
  window.chrome = {
    tabs: {
      query: async () => [{ id: 1, url: 'https://lightroom.adobe.com', favIconUrl: 'https://www.adobe.com/favicon.ico' }],
      sendMessage: async (tabId, message) => {
        console.log('Mock sendMessage:', message);
        if (message.action === 'LIST_TOOLS') {
          const response = {
            message: '',
            tools: [
              { name: 'read_page', description: 'Read page', inputSchema: '{"type":"object","properties":{}}' },
              { name: 'search_parameters', description: 'Search parameters', inputSchema: '{"type":"object","properties":{}}' },
              { name: 'apply_parameters', description: 'Apply parameters', inputSchema: '{"type":"object","properties":{}}' },
              { name: 'export_format', description: 'Export pictures in different formats', inputSchema: '{"type":"object","properties":{}}' },
              { name: 'save', description: 'Save', inputSchema: '{"type":"object","properties":{}}' }
            ],
            url: 'https://lightroom.adobe.com'
          };
          for (const listener of messageListeners) {
            listener(response, { frameId: 0, tab: { id: 1 } });
          }
        }
        return null;
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} }
    },
    runtime: {
      onMessage: {
        addListener: (callback) => {
          messageListeners.push(callback);
        }
      }
    },
    webNavigation: {
      getAllFrames: async () => [{ frameId: 0, url: 'https://lightroom.adobe.com' }]
    }
  };
}

export function App() {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'tools'
  const [showConsent, setShowConsent] = useState(localStorage.nexusConsent !== 'true');
  const [showSettings, setShowSettings] = useState(false);
  const [showToolsDialogue, setShowToolsDialogue] = useState(false);
  const [showIPHPopover, setShowIPHPopover] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Chrome Tab & Tools State
  const [tools, setTools] = useState([]);
  const [domain, setDomain] = useState('');
  const [favicon, setFavicon] = useState('');
  const [contextDetached, setContextDetached] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Provider & Model State
  const [provider, setProvider] = useState(() => {
    return PROVIDERS[localStorage.provider] ? localStorage.provider : 'gemini';
  });
  const [model, setModel] = useState(() => {
    const p = PROVIDERS[localStorage.provider] ? localStorage.provider : 'gemini';
    const m = localStorage[`model_${p}`];
    return PROVIDERS[p].models.includes(m) ? m : PROVIDERS[p].models[0];
  });
  const [apiKey, setApiKey] = useState('');
  const [suggestPrompt, setSuggestPrompt] = useState(localStorage.suggestUserPrompt !== 'false');
  const [theme, setTheme] = useState(localStorage.theme || 'system');

  // Chat & Execution State
  const [userPrompt, setUserPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activityLog, setActivityLog] = useState([]);

  // Refs for state persistence across async turns
  const chatSessionRef = useRef(null);
  const traceRef = useRef([]);
  const lastSuggestedPromptRef = useRef('');
  const userPromptPendingIdRef = useRef(0);
  const chatStreamEndRef = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const providerRef = useRef(provider);
  providerRef.current = provider;

  const modelRef = useRef(model);
  modelRef.current = model;

  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  // Initialize Provider Settings & Environment Variables
  useEffect(() => {
    (async () => {
      let env;
      try {
        const envModule = await import('./.env.json', { with: { type: 'json' } });
        env = envModule.default;
      } catch {}

      if (localStorage.apiKey) {
        localStorage.apiKey_gemini ??= localStorage.apiKey;
        localStorage.removeItem('apiKey');
      }
      if (localStorage.model) {
        localStorage.model_gemini ??= localStorage.model;
        localStorage.removeItem('model');
      }
      if (localStorage.model_gemini === 'gemini-2.5-flash') {
        localStorage.model_gemini = 'gemini-3-flash-preview';
      }

      if (env?.apiKey) localStorage.apiKey_gemini ??= env.apiKey;
      if (env?.openaiApiKey) localStorage.apiKey_openai ??= env.openaiApiKey;
      if (env?.anthropicApiKey) localStorage.apiKey_anthropic ??= env.anthropicApiKey;
      if (env?.model) localStorage.model_gemini ??= env.model;
      if (env?.provider && PROVIDERS[env.provider]) {
        localStorage.provider ??= env.provider;
        setProvider(env.provider);
      }

      const activeP = localStorage.provider || 'gemini';
      const activeK = localStorage[`apiKey_${activeP}`] || '';
      setApiKey(activeK);
    })();
  }, []);

  // Sync API Key when provider changes
  useEffect(() => {
    const k = localStorage[`apiKey_${provider}`] || '';
    setApiKey(k);
    const m = localStorage[`model_${provider}`];
    const validModel = PROVIDERS[provider].models.includes(m) ? m : PROVIDERS[provider].models[0];
    setModel(validModel);
    chatSessionRef.current = null;
  }, [provider]);

  // Apply Theme
  useEffect(() => {
    const applyThemeToDOM = (t) => {
      const dark =
        t === 'dark' ||
        (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    applyThemeToDOM(theme);
    localStorage.theme = theme;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') applyThemeToDOM('system');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Scroll Chat to Bottom
  const scrollToBottom = () => {
    setTimeout(() => {
      chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, busy]);

  // Fetch tools from the currently active tab
  const fetchActiveTabTools = useCallback(async () => {
    if (!window.chrome || !window.chrome.tabs) return;
    try {
      const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      if (tab.favIconUrl) {
        setFavicon(tab.favIconUrl);
      } else if (tab.url) {
        try {
          const u = new URL(tab.url);
          setFavicon(`https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`);
        } catch {}
      }

      if (tab.url) {
        try {
          const u = new URL(tab.url);
          setDomain(u.hostname);
        } catch {
          setDomain(tab.url);
        }
      }

      const fromOrigins = await getIframeOrigins(tab.id);
      await window.chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
    } catch (err) {
      if (!err?.message?.includes('Could not establish connection') && !err?.message?.includes('Receiving end does not exist')) {
        setStatusMsg(String(err));
      }
    }
  }, []);

  // Chrome tab message listener for LIST_TOOLS & Tab lifecycle updates
  useEffect(() => {
    if (!window.chrome || !window.chrome.runtime) return;

    const listener = async ({ message, tools: newTools, url }, sender) => {
      if (sender?.frameId && sender.frameId !== 0) return;
      const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
      if (sender?.tab && tab?.id && sender.tab.id !== tab.id) return;

      setStatusMsg(message || '');

      const parsedTools = newTools || [];
      setTools(parsedTools);
      toolsRef.current = parsedTools;

      let pageUrl = url || sender?.tab?.url || tab?.url || '';
      try {
        const parsedUrl = new URL(pageUrl);
        setDomain(parsedUrl.hostname);
        const iconUrl = sender?.tab?.favIconUrl || tab?.favIconUrl || `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`;
        setFavicon(iconUrl);
      } catch {
        setDomain(pageUrl || 'New Tab');
        if (sender?.tab?.favIconUrl || tab?.favIconUrl) {
          setFavicon(sender?.tab?.favIconUrl || tab?.favIconUrl);
        }
      }
    };

    window.chrome.runtime.onMessage.addListener(listener);

    // Listen to tab activation & tab updates so tools refresh automatically!
    const onTabActivated = () => fetchActiveTabTools();
    const onTabUpdated = (tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        fetchActiveTabTools();
      }
    };

    if (window.chrome.tabs) {
      window.chrome.tabs.onActivated?.addListener(onTabActivated);
      window.chrome.tabs.onUpdated?.addListener(onTabUpdated);
    }

    // Initial query
    fetchActiveTabTools();

    return () => {
      window.chrome.runtime.onMessage.removeListener(listener);
      if (window.chrome.tabs) {
        window.chrome.tabs.onActivated?.removeListener(onTabActivated);
        window.chrome.tabs.onUpdated?.removeListener(onTabUpdated);
      }
    };
  }, [fetchActiveTabTools]);



  // Prompt suggestion logic
  const handleSuggestPrompt = useCallback(async () => {
    if (!suggestPrompt || busyRef.current || toolsRef.current.length === 0 || !apiKeyRef.current) return;

    const userPromptId = ++userPromptPendingIdRef.current;
    try {
      const text = await oneShot({
        provider: providerRef.current,
        apiKey: apiKeyRef.current,
        model: modelRef.current,
        contents: [
          '**Task:** Generate one natural user query for a range of tools below.',
          '**Tools:**',
          JSON.stringify(toolsRef.current),
        ],
      });
      if (userPromptId === userPromptPendingIdRef.current && text) {
        lastSuggestedPromptRef.current = text;
        setUserPrompt(text);
      }
    } catch {}
  }, [suggestPrompt]);

  useEffect(() => {
    if (tools.length > 0 && suggestPrompt && !userPrompt) {
      handleSuggestPrompt();
    }
  }, [tools, suggestPrompt, handleSuggestPrompt]);

  // Execute Tool via Chrome Extension Tabs
  const executeTool = async (name, inputArgs, location) => {
    const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
    const options = !location || location === tab.url ? { frameId: 0 } : {};
    try {
      const result = await window.chrome.tabs.sendMessage(
        tab.id,
        { action: 'EXECUTE_TOOL', name, inputArgs, location },
        options
      );
      if (result !== null) return result;
    } catch (error) {
      if (!error.message?.includes('message channel is closed')) throw error;
    }
    await waitForPageLoad(tab.id);
    return await window.chrome.tabs.sendMessage(tab.id, {
      action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT',
      location,
    });
  };

  const waitForPageLoad = (tabId) => {
    return new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          window.chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      window.chrome.tabs.onUpdated.addListener(listener);
    });
  };

  // Log Activity Helper
  const logActivity = ({ source, name, args }) => {
    const entryId = Date.now() + Math.random();
    const entry = {
      id: entryId,
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      source,
      name,
      args,
      start: performance.now(),
      status: 'running',
    };
    setActivityLog((prev) => [entry, ...prev]);
    return entry;
  };

  const completeActivity = (entry, { result, error }) => {
    const durationMs = Math.round(performance.now() - entry.start);
    setActivityLog((prev) =>
      prev.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              status: error ? 'err' : 'ok',
              durationMs,
              result,
              error,
            }
          : item
      )
    );
  };

  const buildToolDecls = () => {
    const list = toolsRef.current;
    return list.map((tool) => {
      const locationIndex = list.findIndex((t) => t.location === tool.location);
      return {
        name: `_${locationIndex}_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema ? JSON.parse(tool.inputSchema) : { type: 'object', properties: {} },
      };
    });
  };

  const decodeToolName = (encodedName) => {
    const list = toolsRef.current;
    const match = encodedName.match(/^_(\d+)_(.*)$/);
    if (match) {
      const locationIndex = Number(match[1]);
      return { name: match[2], location: list[locationIndex]?.location };
    }
    return { name: encodedName, location: undefined };
  };

  // Main Prompt AI Execution Loop
  const handleSendPrompt = async () => {
    if (busy) {
      setBusy(false);
      return;
    }
    const textToSend = userPrompt.trim();
    if (!textToSend || !apiKey) return;

    setBusy(true);
    setUserPrompt('');

    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: textToSend, meta: 'you' }]);

    try {
      chatSessionRef.current ??= createChat({
        provider,
        apiKey,
        model,
        systemInstruction: [
          'You are an assistant embedded in a browser tab.',
          'User prompts typically refer to the current tab unless stated otherwise.',
          'Use the provided tools to query page content and perform actions.',
          'When new tools become available after an action (such as search filter tools on updated search results), continue executing the appropriate tools to fulfill the user request in full before responding.',
          `Today's date is: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
          'CRITICAL RULE: Whenever the user provides a relative date (e.g., "next Monday", "tomorrow", "in 3 days"), you must calculate the exact calendar date based on today\'s date.',
          'CRITICAL RULE: Do not try to use other tools than the available ones.',
        ],
        toolDecls: buildToolDecls(),
        trace: traceRef.current,
      });

      const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
      chatSessionRef.current?.setTools(buildToolDecls());

      if (!chatSessionRef.current) return;

      let { text, toolCalls } = await chatSessionRef.current.send(textToSend);
      let messageRendered = false;
      let turnCount = 0;
      const MAX_TURNS = 10;

      while (toolCalls && toolCalls.length > 0 && busyRef.current && turnCount < MAX_TURNS) {
        turnCount++;
        if (text?.trim()) {
          setMessages((prev) => [...prev, { id: Date.now(), role: 'ai', text: text.trim(), meta: model }]);
          messageRendered = true;
        }

        const results = [];
        for (const call of toolCalls) {
          if (!busyRef.current) break;
          const { name, location } = decodeToolName(call.name);
          const entry = logActivity({ source: 'assistant', name, args: call.args });

          try {
            const res = await executeTool(name, JSON.stringify(call.args), location);
            completeActivity(entry, { result: res });
            results.push({ id: call.id, name: call.name, result: res });
          } catch (err) {
            const errorMsg = err?.message || String(err);
            completeActivity(entry, { error: errorMsg });
            results.push({ id: call.id, name: call.name, error: errorMsg });
          }
        }

        // Re-query LIST_TOOLS from active tab frame 0 in case tool execution triggered page navigation / dynamic form loading!
        if (tab?.id) {
          try {
            const fromOrigins = await getIframeOrigins(tab.id);
            await window.chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS', fromOrigins }, { frameId: 0 });
          } catch {}
        }

        await new Promise((r) => setTimeout(r, 500));
        if (!busyRef.current) break;

        chatSessionRef.current?.setTools(buildToolDecls());
        if (!chatSessionRef.current) break;
        ({ text, toolCalls } = await chatSessionRef.current.sendToolResults(results));
      }

      if (text?.trim()) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'ai', text: text.trim(), meta: model }]);
      } else if (!messageRendered) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: 'The model returned an empty response.' }]);
      }
    } catch (err) {
      traceRef.current.push({ error: String(err) });
      setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: String(err) }]);
      // Reset chat session on error so corrupted/unanswered functionCall turns do not poison future turns
      chatSessionRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  // Reset Conversation
  const handleReset = () => {
    chatSessionRef.current = null;
    traceRef.current = [];
    setUserPrompt('');
    setMessages([]);
    setBusy(false);
  };

  // Set API key prompt handler
  const handlePromptApiKey = (targetProvider = provider) => {
    const currentKey = localStorage[`apiKey_${targetProvider}`] || '';
    const label = PROVIDERS[targetProvider]?.label || targetProvider;
    const key = prompt(`Enter ${label} API key`, currentKey);
    if (key === null) return;
    const trimmed = key.trim();
    if (trimmed) {
      localStorage[`apiKey_${targetProvider}`] = trimmed;
      if (targetProvider === provider) {
        setApiKey(trimmed);
      }
    } else {
      localStorage.removeItem(`apiKey_${targetProvider}`);
      if (targetProvider === provider) {
        setApiKey('');
      }
    }
    chatSessionRef.current = null;
  };

  // Toggle model picker dropdown
  const handleModelPickerClick = () => {
    const modelsList = PROVIDERS[provider].models;
    const currentIndex = modelsList.indexOf(model);
    const nextModel = modelsList[(currentIndex + 1) % modelsList.length];
    localStorage[`model_${provider}`] = nextModel;
    setModel(nextModel);
    chatSessionRef.current = null;
  };

  // Derive dynamic welcome subtitle topic based on active domain
  let domainTopic = 'your tasks';
  if (domain.includes('adobe') || domain.includes('photo') || domain.includes('lightroom')) {
    domainTopic = 'your photographs';
  } else if (domain.includes('flight') || domain.includes('booking') || domain.includes('hotel')) {
    domainTopic = 'your hotel search';
  } else if (domain && domain !== 'New Tab') {
    domainTopic = domain;
  }

  // Select model handler
  const handleSelectModel = (newProvider, newModel) => {
    if (newProvider !== provider) {
      setProvider(newProvider);
      localStorage.provider = newProvider;
    }
    setModel(newModel);
    localStorage[`model_${newProvider}`] = newModel;
    chatSessionRef.current = null;
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
    <div className="nexus-screen-shell">
      {/* Consent Screen Modal Overlay */}
      {showConsent && (
        <div className="nexus-modal-overlay">
          <NexusConsentScreen
            onGotIt={() => {
              localStorage.nexusConsent = 'true';
              setShowConsent(false);
            }}
            onClose={() => setShowConsent(false)}
          />
        </div>
      )}

      {/* Main Top Header */}
      <Header
        title="AGENT"
        variant="agent"
        onEdit={handleReset}
        onSettings={() => setShowSettings(true)}
        onClose={() => window.close()}
      />

      {/* Error / Status Notice */}
      {statusMsg && <div id="status">{statusMsg}</div>}

      <main>
        {activeTab === 'chat' && (
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

              {/* Message History */}
              {messages.map((msg) => (
                <div key={msg.id} className={`msg ${msg.role}`}>
                  {msg.meta && <div className="msg-meta">{msg.meta}</div>}
                  <div className="msg-body">
                    {msg.role === 'ai' ? (
                      <MarkdownText content={msg.text} />
                    ) : (
                      msg.text
                    )}
                  </div>
                </div>
              ))}

              {/* Pending Typist Animation */}
              {busy && (
                <div className="chat-pending">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}

              <div ref={chatStreamEndRef} />
            </div>

            {/* Missing API Key Notice Banner */}
            {!apiKey && (
              <div id="keyNotice" className="key-notice">
                <span>No {PROVIDERS[provider].label} API key set.</span>
                <button className="btn ghost small" onClick={handlePromptApiKey}>
                  Set API key
                </button>
              </div>
            )}

            {/* Bottom Floating Composer (ChatBubble) */}
            <footer className="nexus-composer-footer">
              {/* Floating WebMCP Tools Dialogue Popover */}
              {showToolsDialogue && (
                <div className="nexus-floating-popover">
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
                <div className="nexus-floating-popover">
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
                  placeholder: 'Ask Nexus anything',
                  onChange: (e) => setUserPrompt(e.target.value),
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
        )}

        {/* Tools Inspector View */}
        {activeTab === 'tools' && (
          <ToolsInspectorScreen
            tools={tools}
            activityLog={activityLog}
            domain={domain}
            onBackToChat={() => setActiveTab('chat')}
            onClearActivity={() => setActivityLog([])}
            onExecuteTool={executeTool}
          />
        )}
      </main>

      {/* Settings Modal */}
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
        onToggleSuggestPrompt={(checked) => {
          setSuggestPrompt(checked);
          localStorage.suggestUserPrompt = checked;
        }}
      />
    </div>
  );
}

export default App;
