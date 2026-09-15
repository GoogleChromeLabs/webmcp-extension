/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { getSpotlighting, resetChatSession, sendChatTurn } from '../services/chatBridge.js';
import { executeTabTool, requestTabTools } from '../services/extensionBridge.js';
import { buildToolDecls, decodeToolName, isToolUntrusted } from '../services/toolEncoder.js';
import {
  ActivityEntry,
  ChatMessage,
  ChatTurnResponse,
  WebMCPTool,
} from '../types/index.js';

export interface UseAgentSessionOptions {
  sensitiveActionAlerts?: boolean;
  /** Run the model on the device through the Prompt API instead of the server. */
  onDeviceModel?: boolean;
}

export interface PendingToolPermission {
  toolName: string;
  toolDescription?: string;
  args?: unknown;
  allow: () => void;
  deny: () => void;
}

export interface UseAgentSessionReturn {
  userPrompt: string;
  setUserPrompt: Dispatch<SetStateAction<string>>;
  messages: ChatMessage[];
  /** The reply being written right now, until it becomes one of `messages`. */
  streamingText: string;
  busy: boolean;
  activityLog: ActivityEntry[];
  pendingPermission: PendingToolPermission | null;
  handleSendPrompt: () => Promise<void>;
  handleStop: () => void;
  handleReset: () => void;
}

export const MAX_TOOL_RESPONSE_CHARS = 8000;

export function applyTokenLimit(result: unknown): unknown {
  if (result === undefined || result === null) return result;
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str && str.length > MAX_TOOL_RESPONSE_CHARS) {
    console.warn(
      `[WebMCP Security] Tool payload exceeded limit: ${str.length} chars (max: ${MAX_TOOL_RESPONSE_CHARS})`
    );
    const truncated = str.slice(0, MAX_TOOL_RESPONSE_CHARS);
    return `${truncated}\n\n[WEBMCP_SECURITY_WARNING: Tool response exceeded maximum allowable limit (${str.length} > ${MAX_TOOL_RESPONSE_CHARS} characters) and was truncated to protect against context exhaustion and prompt injection.]`;
  }
  return result;
}

export function applySpotlighting(result: unknown, tool?: WebMCPTool, fence?: string): unknown {
  if (!isToolUntrusted(tool)) return result;

  const rawStr = typeof result === 'string' ? result : JSON.stringify(result);

  // Encoding is the stronger spotlighting, but it takes a model that decodes
  // base64 reliably. Callers that pass a fence get delimiting instead, with
  // any forged closing marker stripped so the data cannot break out.
  if (fence) {
    const fenced = (rawStr || '').split(`</${fence}>`).join('');
    return `<${fence}>\n${fenced}\n</${fence}>`;
  }

  try {
    return btoa(unescape(encodeURIComponent(rawStr || '')));
  } catch {
    return Buffer.from(rawStr || '', 'utf-8').toString('base64');
  }
}

/**
 * Refreshes the page's tools after a round of tool calls, and waits until they
 * have settled, so the next request declares the tools the page has now.
 *
 * A call can change them, by navigating, or by rendering a view with tools of
 * its own, and a page can take a while to register those: the content script
 * only reports the list once its changes have paused. So this waits for a
 * report, then for `quietMs` without another, and gives up after `timeoutMs`,
 * keeping whatever tools arrived by then.
 */
export async function waitForToolsToSettle(
  toolsRef: MutableRefObject<WebMCPTool[]>,
  {
    requestTools,
    signal,
    quietMs = 250,
    timeoutMs = 2000,
    pollMs = 25,
  }: {
    requestTools: () => Promise<void>;
    signal?: AbortSignal;
    quietMs?: number;
    timeoutMs?: number;
    pollMs?: number;
  }
): Promise<void> {
  const start = performance.now();
  // Every report replaces the array, even when the tools are the same.
  let seen = toolsRef.current;
  let lastReport: number | null = null;

  try {
    await requestTools();
  } catch {}

  while (!signal?.aborted && performance.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (toolsRef.current !== seen) {
      seen = toolsRef.current;
      lastReport = performance.now();
    }
    if (lastReport !== null && performance.now() - lastReport >= quietMs) return;
  }
}

let nextId = Date.now();
const generateId = (): number => ++nextId;

export function useAgentSession(
  toolsOrRef: WebMCPTool[] | MutableRefObject<WebMCPTool[]>,
  options?: UseAgentSessionOptions
): UseAgentSessionReturn {
  // Chat & Execution State
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const streamingTextRef = useRef<string>('');
  const showStreamingText = (text: string) => {
    streamingTextRef.current = text;
    setStreamingText(text);
  };
  const [pendingPermission, setPendingPermission] = useState<PendingToolPermission | null>(null);

  // Settings sync refs
  const sensitiveActionAlertsRef = useRef<boolean>(options?.sensitiveActionAlerts ?? true);
  useEffect(() => {
    sensitiveActionAlertsRef.current = options?.sensitiveActionAlerts ?? true;
  }, [options?.sensitiveActionAlerts]);

  const onDeviceModelRef = useRef<boolean>(options?.onDeviceModel ?? false);
  useEffect(() => {
    // Switching backends starts a new conversation: neither one can carry on
    // where the other left off.
    if (onDeviceModelRef.current !== (options?.onDeviceModel ?? false)) {
      resetChatSession({ chatId: chatIdRef.current, onDevice: onDeviceModelRef.current });
      chatIdRef.current = undefined;
    }
    onDeviceModelRef.current = options?.onDeviceModel ?? false;
  }, [options?.onDeviceModel]);

  // Safely support either MutableRefObject or raw tools array without breaking encapsulation
  const internalToolsRef = useRef<WebMCPTool[]>([]);
  const activeToolsRef = 'current' in toolsOrRef ? toolsOrRef : internalToolsRef;
  if (!('current' in toolsOrRef)) {
    internalToolsRef.current = toolsOrRef;
  }

  // Persistent refs for async turn execution
  const chatIdRef = useRef<string | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnLogsRef = useRef<ActivityEntry[]>([]);

  // Cleanup in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      setPendingPermission(null);
    };
  }, []);

  // Activity logger helpers
  const logActivity = (source: 'assistant' | 'user', name: string, args: unknown): ActivityEntry => {
    const entry: ActivityEntry = {
      id: generateId(),
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      source,
      name,
      args,
      start: performance.now(),
      status: 'running',
    };
    turnLogsRef.current = [entry, ...turnLogsRef.current];
    setActivityLog((prev) => [entry, ...prev]);
    return entry;
  };

  const completeActivity = (entry: ActivityEntry, { result, error }: { result?: unknown; error?: string }) => {
    const durationMs = Math.round(performance.now() - entry.start);
    const update = (item: ActivityEntry) =>
      item.id === entry.id
        ? {
            ...item,
            status: (error ? 'err' : 'ok') as 'ok' | 'err',
            durationMs,
            result,
            error,
          }
        : item;

    turnLogsRef.current = turnLogsRef.current.map(update);
    setActivityLog((prev) => prev.map(update));
  };

  // Dedicated cancellation handler
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // What was written before the stop stays, rather than vanishing.
    const partial = streamingTextRef.current.trim();
    if (partial) {
      const logs = [...turnLogsRef.current];
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', text: partial, activityLogs: logs }]);
    }
    showStreamingText('');
    setPendingPermission(null);
    setBusy(false);
  }, []);

  // Reset chat session state
  const handleReset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    resetChatSession({ chatId: chatIdRef.current, onDevice: onDeviceModelRef.current });
    chatIdRef.current = undefined;
    turnLogsRef.current = [];
    setUserPrompt('');
    setMessages([]);
    setActivityLog([]);
    showStreamingText('');
    setPendingPermission(null);
    setBusy(false);
  }, []);

  // Main prompt sending logic via backend
  const handleSendPrompt = useCallback(async () => {
    if (busy) return;

    const textToSend = userPrompt.trim();
    if (!textToSend) return;

    // Initialize turn abort controller
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;
    // Replies are shown as they are written, and become messages once done.
    const onText = (text: string) => {
      if (!signal.aborted) showStreamingText(text);
    };

    setBusy(true);
    setUserPrompt('');
    setPendingPermission(null);
    turnLogsRef.current = [];
    setActivityLog([]);
    setMessages((prev) => [
      ...prev,
      { id: generateId(), role: 'user', text: textToSend, meta: 'you' },
    ]);

    try {
      const toolDecls = buildToolDecls(activeToolsRef.current);
      let currentResult: ChatTurnResponse = await sendChatTurn(
        {
          message: textToSend,
          tools: toolDecls,
          chatId: chatIdRef.current,
        },
        { signal, onDevice: onDeviceModelRef.current, onText }
      );

      if (signal.aborted) return;
      // Batched with the message the text becomes, so nothing flickers.
      showStreamingText('');

      if (currentResult.chatId) {
        chatIdRef.current = currentResult.chatId;
      }

      let messageRendered = false;
      let turnCount = 0;
      const MAX_TURNS = 10;

      while (
        currentResult.functionCalls &&
        currentResult.functionCalls.length > 0 &&
        !signal.aborted &&
        turnCount < MAX_TURNS
      ) {
        turnCount++;
        if (currentResult.text?.trim()) {
          const logs = [...turnLogsRef.current];
          setMessages((prev) => [
            ...prev,
            { id: generateId(), role: 'ai', text: currentResult.text!.trim(), activityLogs: logs },
          ]);
          messageRendered = true;
        }

        const toolResponses = [];
        for (const call of currentResult.functionCalls) {
          if (signal.aborted) break;
          const { name, frameId } = decodeToolName(call.name);
          // Find the tool declaration in activeToolsRef
          const targetTool =
            activeToolsRef.current.find(
              (t) => t.name === name && (frameId === undefined || t.frameId === frameId)
            ) ||
            activeToolsRef.current.find((t) => t.name === name);

          const isReadOnly = targetTool?.readOnlyHint === true;
          const entry = logActivity('assistant', name, call.args);

          // If sensitive action alerts is enabled and tool is not readonly, prompt the user before execution
          if (sensitiveActionAlertsRef.current && !isReadOnly) {
            const allowed = await new Promise<boolean>((resolve) => {
              const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                setPendingPermission(null);
                resolve(false);
              };

              if (signal.aborted) {
                resolve(false);
                return;
              }

              signal.addEventListener('abort', onAbort, { once: true });

              setPendingPermission({
                toolName: targetTool?.name || name,
                toolDescription: targetTool?.description,
                args: call.args,
                allow: () => {
                  signal.removeEventListener('abort', onAbort);
                  setPendingPermission(null);
                  resolve(true);
                },
                deny: () => {
                  signal.removeEventListener('abort', onAbort);
                  setPendingPermission(null);
                  resolve(false);
                },
              });
            });

            if (signal.aborted) break;

            if (!allowed) {
              completeActivity(entry, { error: 'User denied permission' });
              toolResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { error: 'User denied permission to execute this tool.' },
                },
              });
              continue;
            }
          }

          try {
            // Security Note: This is where you might utilize a critic to check that the
            // tool call and parameters align with the user's intent before execution.
            const rawRes = await executeTabTool(name, call.args, frameId);
            if (signal.aborted) break;

            const limitedRes = applyTokenLimit(rawRes);
            const res = applySpotlighting(
              limitedRes,
              targetTool,
              getSpotlighting({ onDevice: onDeviceModelRef.current })
            );

            // Security Note: This is where you might utilize a prompt injection classifier to
            // detect any prompt injection in the tool output before returning it to the model.
            completeActivity(entry, { result: res });
            toolResponses.push({
              functionResponse: { name: call.name, response: { result: res } },
            });
          } catch (err: unknown) {
            if (signal.aborted) break;
            const errorMsg = (err as Error)?.message || String(err);
            completeActivity(entry, { error: errorMsg });
            toolResponses.push({
              functionResponse: { name: call.name, response: { error: errorMsg } },
            });
          }
        }

        if (signal.aborted) break;

        await waitForToolsToSettle(activeToolsRef, { requestTools: requestTabTools, signal });
        if (signal.aborted) break;

        const updatedTools = buildToolDecls(activeToolsRef.current);

        currentResult = await sendChatTurn(
          {
            toolResponses,
            tools: updatedTools,
            chatId: chatIdRef.current,
          },
          { signal, onDevice: onDeviceModelRef.current, onText }
        );

        if (signal.aborted) break;
        showStreamingText('');

        if (currentResult.chatId) {
          chatIdRef.current = currentResult.chatId;
        }
      }

      if (signal.aborted) return;

      if (currentResult.text?.trim()) {
        const logs = [...turnLogsRef.current];
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: 'ai', text: currentResult.text!.trim(), activityLogs: logs },
        ]);
      } else if (!messageRendered && (!currentResult.functionCalls || currentResult.functionCalls.length === 0)) {
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: 'error', text: 'The model returned an empty response.' },
        ]);
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      showStreamingText('');
      const errorMsg = (err as Error)?.message || String(err);
      setMessages((prev) => [...prev, { id: generateId(), role: 'error', text: errorMsg }]);
      chatIdRef.current = undefined;
    } finally {
      if (!signal.aborted) {
        setPendingPermission(null);
        setBusy(false);
      }
    }
  }, [busy, userPrompt, activeToolsRef]);

  return {
    userPrompt,
    setUserPrompt,
    messages,
    streamingText,
    busy,
    activityLog,
    pendingPermission,
    handleSendPrompt,
    handleStop,
    handleReset,
  };
}

export default useAgentSession;
