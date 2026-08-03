/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, MutableRefObject, Dispatch, SetStateAction } from 'react';
import { PROVIDERS } from '../providers.js';
import { buildToolDecls, decodeToolName } from '../services/toolEncoder.js';
import { executeTabTool, requestTabTools } from '../services/extensionBridge.js';
import { callBackend } from '../services/backendBridge.js';
import {
  WebMCPTool,
  ProviderKey,
  ChatMessage,
  ActivityEntry,
} from '../types/index.js';

export interface UseAgentSessionReturn {
  provider: ProviderKey;
  setProvider: (p: ProviderKey) => void;
  model: string;
  setModel: (m: string) => void;
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
}

interface BackendChatResponse {
  chatId?: string;
  text?: string;
  functionCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
}

export function useAgentSession(toolsRef: MutableRefObject<WebMCPTool[]>): UseAgentSessionReturn {
  // Provider & Model State
  const [provider, setProviderState] = useState<ProviderKey>(() => {
    return PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini';
  });
  const [model, setModelState] = useState<string>(() => {
    const p = PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini';
    const m = localStorage[`model_${p}`];
    return PROVIDERS[p]?.models.includes(m) ? m : PROVIDERS[p]?.models[0];
  });
  const [suggestPrompt, setSuggestPrompt] = useState<boolean>(localStorage.suggestUserPrompt !== 'false');

  // Chat & Execution State
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  // Persistent refs for async turn execution
  const chatIdRef = useRef<string | undefined>(undefined);
  const traceRef = useRef<unknown[]>([]);
  const userPromptPendingIdRef = useRef<number>(0);
  const busyRef = useRef<boolean>(false);
  busyRef.current = busy;

  const providerRef = useRef<ProviderKey>(provider);
  providerRef.current = provider;

  const modelRef = useRef<string>(model);
  modelRef.current = model;

  // Sync active model with backend on startup
  useEffect(() => {
    callBackend('/api/model', { model: modelRef.current }).catch(() => {});
  }, []);

  // Provider and Model change setters
  const setProvider = useCallback((newProvider: ProviderKey) => {
    if (PROVIDERS[newProvider]) {
      localStorage.provider = newProvider;
      setProviderState(newProvider);
      chatIdRef.current = undefined;
    }
  }, []);

  const setModel = useCallback((newModel: string) => {
    setModelState(newModel);
    localStorage[`model_${providerRef.current}`] = newModel;
    callBackend('/api/model', { model: newModel, chatId: chatIdRef.current }).catch(() => {});
    chatIdRef.current = undefined;
  }, []);

  // Prompt suggestions generator via backend
  const handleSuggestPrompt = useCallback(async () => {
    if (!suggestPrompt || busyRef.current || toolsRef.current.length === 0) return;

    const userPromptId = ++userPromptPendingIdRef.current;
    try {
      const res = await callBackend<{ text: string }>('/api/suggest-prompt', {
        tools: toolsRef.current,
      });
      if (userPromptId === userPromptPendingIdRef.current && res.text) {
        setUserPrompt(res.text);
      }
    } catch (e) {
      console.warn('Suggest prompt failed:', e);
    }
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

  // Main prompt sending logic via backend
  const handleSendPrompt = async () => {
    if (busy) {
      setBusy(false);
      return;
    }
    const textToSend = userPrompt.trim();
    if (!textToSend) return;

    setBusy(true);
    setUserPrompt('');
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: textToSend, meta: 'you' }]);

    try {
      const toolDecls = buildToolDecls(toolsRef.current);
      let currentResult = await callBackend<BackendChatResponse>('/api/chat', {
        message: textToSend,
        tools: toolDecls,
        chatId: chatIdRef.current,
      });

      if (currentResult.chatId) {
        chatIdRef.current = currentResult.chatId;
      }

      let messageRendered = false;
      let turnCount = 0;
      const MAX_TURNS = 10;

      while (
        currentResult.functionCalls &&
        currentResult.functionCalls.length > 0 &&
        busyRef.current &&
        turnCount < MAX_TURNS
      ) {
        turnCount++;
        if (currentResult.text?.trim()) {
          setMessages((prev) => [...prev, { id: Date.now(), role: 'ai', text: currentResult.text!.trim(), meta: modelRef.current }]);
          messageRendered = true;
        }

        const toolResponses = [];
        for (const call of currentResult.functionCalls) {
          if (!busyRef.current) break;
          const { name, location } = decodeToolName(toolsRef.current, call.name);
          const entry = logActivity('assistant', name, call.args);

          try {
            const res = await executeTabTool(name, JSON.stringify(call.args), location);
            completeActivity(entry, { result: res });
            let resVal: unknown;
            if (res === undefined || res === null || res === '') {
              resVal = { status: 'success', message: 'Tool executed successfully on page.' };
            } else {
              resVal = { result: res };
            }
            toolResponses.push({
              functionResponse: { name: call.name, response: resVal },
            });
          } catch (err: unknown) {
            const errorMsg = (err as Error)?.message || String(err);
            completeActivity(entry, { error: errorMsg });
            toolResponses.push({
              functionResponse: { name: call.name, response: { error: errorMsg } },
            });
          }
        }

        try {
          await requestTabTools();
        } catch {}

        await new Promise((r) => setTimeout(r, 500));
        if (!busyRef.current) break;

        const updatedTools = buildToolDecls(toolsRef.current);

        currentResult = await callBackend<BackendChatResponse>('/api/chat', {
          toolResponses,
          tools: updatedTools,
          chatId: chatIdRef.current,
        });

        if (currentResult.chatId) {
          chatIdRef.current = currentResult.chatId;
        }
      }

      if (currentResult.text?.trim()) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'ai', text: currentResult.text!.trim(), meta: modelRef.current }]);
      } else if (!messageRendered && (!currentResult.functionCalls || currentResult.functionCalls.length === 0)) {
        setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: 'The model returned an empty response.' }]);
      }
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || String(err);
      traceRef.current.push({ error: errorMsg });
      setMessages((prev) => [...prev, { id: Date.now(), role: 'error', text: errorMsg }]);
      chatIdRef.current = undefined;
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    if (chatIdRef.current) {
      callBackend('/api/reset', { chatId: chatIdRef.current }).catch(() => {});
    }
    chatIdRef.current = undefined;
    traceRef.current = [];
    setUserPrompt('');
    setMessages([]);
    setBusy(false);
  };

  return {
    provider,
    setProvider,
    model,
    setModel,
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
  };
}

export default useAgentSession;
