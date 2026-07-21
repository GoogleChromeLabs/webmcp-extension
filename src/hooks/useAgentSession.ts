/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, MutableRefObject, Dispatch, SetStateAction } from 'react';
import { PROVIDERS, createChat, oneShot } from '../providers.js';
import { buildToolDecls, decodeToolName } from '../services/toolEncoder.js';
import { executeTabTool, requestTabTools } from '../services/extensionBridge.js';
import {
  WebMCPTool,
  ProviderKey,
  ChatMessage,
  ActivityEntry,
  IChatSession,
  ToolResult,
  DecodedToolCall,
} from '../types/index.js';

export interface UseAgentSessionReturn {
  provider: ProviderKey;
  setProvider: (p: ProviderKey) => void;
  model: string;
  setModel: (m: string) => void;
  apiKey: string;
  setApiKey: Dispatch<SetStateAction<string>>;
  suggestPrompt: boolean;
  setSuggestPrompt: Dispatch<SetStateAction<boolean>>;
  userPrompt: string;
  setUserPrompt: Dispatch<SetStateAction<string>>;
  messages: ChatMessage[];
  busy: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  handleSendPrompt: () => Promise<void>;
  handleReset: () => void;
  handlePromptApiKey: (targetProvider?: ProviderKey) => void;
}

export function useAgentSession(toolsRef: MutableRefObject<WebMCPTool[]>): UseAgentSessionReturn {
  // Provider & Model State
  const [provider, setProviderState] = useState<ProviderKey>(() => {
    return PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini';
  });
  const [model, setModelState] = useState<string>(() => {
    const p = PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini';
    const m = localStorage[`model_${p}`];
    return PROVIDERS[p].models.includes(m) ? m : PROVIDERS[p].models[0];
  });
  const [apiKey, setApiKey] = useState<string>('');
  const [suggestPrompt, setSuggestPrompt] = useState<boolean>(localStorage.suggestUserPrompt !== 'false');

  // Chat & Execution State
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  // Persistent refs for async turn execution
  const chatSessionRef = useRef<IChatSession | null>(null);
  const traceRef = useRef<unknown[]>([]);
  const userPromptPendingIdRef = useRef<number>(0);
  const busyRef = useRef<boolean>(false);
  busyRef.current = busy;

  const providerRef = useRef<ProviderKey>(provider);
  providerRef.current = provider;

  const modelRef = useRef<string>(model);
  modelRef.current = model;

  const apiKeyRef = useRef<string>(apiKey);
  apiKeyRef.current = apiKey;

  // Environment variables & initial settings migration
  useEffect(() => {
    (async () => {
      let env: Record<string, string> | undefined;
      try {
        const envModule = await import('../.env.json', { with: { type: 'json' } });
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
      if (env?.provider && PROVIDERS[env.provider as ProviderKey]) {
        localStorage.provider ??= env.provider;
        setProviderState(env.provider as ProviderKey);
      }

      const activeP = (localStorage.provider as ProviderKey) || 'gemini';
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
    setModelState(validModel);
    chatSessionRef.current = null;
  }, [provider]);

  // Provider and Model change setters
  const setProvider = useCallback((newProvider: ProviderKey) => {
    if (PROVIDERS[newProvider]) {
      localStorage.provider = newProvider;
      setProviderState(newProvider);
      chatSessionRef.current = null;
    }
  }, []);

  const setModel = useCallback((newModel: string) => {
    setModelState(newModel);
    localStorage[`model_${providerRef.current}`] = newModel;
    chatSessionRef.current = null;
  }, []);

  // Prompt suggestions generator
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
        setUserPrompt(text);
      }
    } catch {}
  }, [suggestPrompt, toolsRef]);

  useEffect(() => {
    if (toolsRef.current.length > 0 && suggestPrompt && !userPrompt) {
      handleSuggestPrompt();
    }
  }, [toolsRef.current, suggestPrompt, handleSuggestPrompt, userPrompt]);

  // Activity logger helpers
  const logActivity = (source: 'assistant' | 'user', name: string, args: unknown): ActivityEntry => {
    const entryId = Date.now() + Math.random();
    const entry: ActivityEntry = {
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

  const completeActivity = (entry: ActivityEntry, { result, error }: { result?: unknown; error?: string }) => {
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

  // Main prompt sending logic
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
        toolDecls: buildToolDecls(toolsRef.current),
        trace: traceRef.current,
      });

      chatSessionRef.current?.setTools(buildToolDecls(toolsRef.current));
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

        const results: ToolResult[] = [];
        for (const call of toolCalls) {
          if (!busyRef.current) break;
          const { name, location } = decodeToolName(toolsRef.current, call.name);
          const entry = logActivity('assistant', name, call.args);

          try {
            const res = await executeTabTool(name, JSON.stringify(call.args), location);
            completeActivity(entry, { result: res });
            results.push({ id: call.id, name: call.name, result: res });
          } catch (err: unknown) {
            const errorMsg = (err as Error)?.message || String(err);
            completeActivity(entry, { error: errorMsg });
            results.push({ id: call.id, name: call.name, error: errorMsg });
          }
        }

        try {
          await requestTabTools();
        } catch {}

        await new Promise((r) => setTimeout(r, 500));
        if (!busyRef.current) break;

        chatSessionRef.current?.setTools(buildToolDecls(toolsRef.current));
        if (!chatSessionRef.current) break;
        const res: { text: string; toolCalls?: DecodedToolCall[] } = await chatSessionRef.current.sendToolResults(results);
        text = res.text;
        toolCalls = res.toolCalls;
      }

      if (text?.trim()) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'ai', text: text.trim(), meta: model }]);
      } else if (!messageRendered) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: 'The model returned an empty response.' }]);
      }
    } catch (err: unknown) {
      traceRef.current.push({ error: String(err) });
      setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: String(err) }]);
      chatSessionRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    chatSessionRef.current = null;
    traceRef.current = [];
    setUserPrompt('');
    setMessages([]);
    setBusy(false);
  };

  const handlePromptApiKey = (targetProvider = provider) => {
    const currentKey = localStorage[`apiKey_${targetProvider}`] || '';
    const label = PROVIDERS[targetProvider]?.label || targetProvider;
    const key = prompt(`Enter ${label} API key`, currentKey);
    if (key === null) return;
    const trimmed = key.trim();
    if (trimmed) {
      localStorage[`apiKey_${targetProvider}`] = trimmed;
      if (targetProvider === provider) setApiKey(trimmed);
    } else {
      localStorage.removeItem(`apiKey_${targetProvider}`);
      if (targetProvider === provider) setApiKey('');
    }
    chatSessionRef.current = null;
  };

  return {
    provider,
    setProvider,
    model,
    setModel,
    apiKey,
    setApiKey,
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
  };
}
