/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dispatch, MutableRefObject, SetStateAction, useRef, useState, useEffect } from 'react';
import { callBackend } from '../services/backendBridge';
import { executeTabTool, requestTabTools } from '../services/extensionBridge';
import { buildToolDecls, decodeToolName } from '../services/toolEncoder';
import { ActivityEntry, ChatMessage, WebMCPTool } from '../types';

export interface UseAgentSessionReturn {
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
  // Chat & Execution State
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  // Persistent refs for async turn execution
  const chatIdRef = useRef<string | undefined>(undefined);
  const traceRef = useRef<unknown[]>([]);
  const busyRef = useRef<boolean>(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Activity logger helpers
  const logActivity = (
    source: 'assistant' | 'user',
    name: string,
    args: unknown,
    currentTurnLogs: ActivityEntry[]
  ): ActivityEntry => {
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
    currentTurnLogs.unshift(entry);
    setActivityLog([...currentTurnLogs]);
    return entry;
  };

  const completeActivity = (
    entry: ActivityEntry,
    { result, error }: { result?: unknown; error?: string },
    currentTurnLogs: ActivityEntry[]
  ) => {
    const durationMs = Math.round(performance.now() - entry.start);
    entry.status = error ? 'err' : 'ok';
    entry.durationMs = durationMs;
    entry.result = result;
    entry.error = error;
    setActivityLog([...currentTurnLogs]);
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
    setActivityLog([]);
    const currentTurnLogs: ActivityEntry[] = [];
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: 'user', text: textToSend, meta: 'you' },
    ]);

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
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now(),
              role: 'ai',
              text: currentResult.text!.trim(),
              activityLogs: [...currentTurnLogs],
            },
          ]);
          messageRendered = true;
        }

        const toolResponses = [];
        for (const call of currentResult.functionCalls) {
          if (!busyRef.current) break;
          const { name, location } = decodeToolName(toolsRef.current, call.name);
          const entry = logActivity('assistant', name, call.args, currentTurnLogs);

          try {
            const res = await executeTabTool(name, JSON.stringify(call.args), location);
            completeActivity(entry, { result: res }, currentTurnLogs);
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
            completeActivity(entry, { error: errorMsg }, currentTurnLogs);
            toolResponses.push({
              functionResponse: { name: call.name, response: { error: errorMsg } },
            });
          }
        }

        try {
          await requestTabTools();
        } catch {
          // Tab tools refresh error ignored when tab is navigating
        }

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

      if (!busyRef.current) {
        return;
      }

      if (currentResult.text?.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'ai',
            text: currentResult.text!.trim(),
            activityLogs: [...currentTurnLogs],
          },
        ]);
      } else if (
        !messageRendered &&
        (!currentResult.functionCalls || currentResult.functionCalls.length === 0)
      ) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'error',
            text: 'The model returned an empty response.',
            activityLogs: [...currentTurnLogs],
          },
        ]);
      }
    } catch (err: unknown) {
      if (!busyRef.current) return;
      const errorMsg = (err as Error)?.message || String(err);
      traceRef.current.push({ error: errorMsg });
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), role: 'error', text: errorMsg, activityLogs: [...currentTurnLogs] },
      ]);
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
