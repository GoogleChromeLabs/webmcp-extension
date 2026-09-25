/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatErrorMessage } from '../services/backendBridge.js';
import { getSpotlighting, resetChatSession, sendChatTurn } from '../services/chatBridge.js';
import { syncDirectGeminiHistory } from '../services/directGeminiBackend.js';
import { executeTabTool, getTabInfo, requestTabTools } from '../services/extensionBridge.js';
import {
  GeminiLiveSession,
  LIVE_MODEL_ID_DEFAULT,
  LiveFunctionResponse,
  LiveToolCall,
  VoiceStatus,
} from '../services/geminiLive.js';
import { tabSessions } from '../services/tabSessionStore.js';
import { buildToolDecls, decodeToolName, isToolUntrusted } from '../services/toolEncoder.js';
import {
  applyToolPermissionDecision,
  clearSessionToolPermissions,
  isGrantEligible,
  needsToolPermission,
  originOfUrl,
  ToolPermissionDecision,
} from '../services/toolPermissions.js';
import {
  ActivityEntry,
  ChatMessage,
  ChatTurnResponse,
  PendingToolPermission,
  UserFacingError,
  WebMCPTool,
} from '../types/index.js';

export interface UseAgentSessionOptions {
  sensitiveActionAlerts?: boolean;
  /** Run the model on the device through the Prompt API instead of the server. */
  onDeviceModel?: boolean;
  /**
   * The origin of the page the tools belong to, such as `https://example.com`.
   * Permission granted for the rest of the session is remembered against it,
   * so the same tool name on another site still has to be allowed there.
   */
  origin?: string;
}

export interface UseAgentSessionReturn {
  userPrompt: string;
  setUserPrompt: Dispatch<SetStateAction<string>>;
  messages: ChatMessage[];
  /** The reply being written right now, until it becomes one of `messages`. */
  streamingText: string;
  busy: boolean;
  /** Set while any tab is mid-turn, including tabs that are not in front. */
  anyBusy: boolean;
  activityLog: ActivityEntry[];
  pendingPermission: PendingToolPermission | null;
  handleSendPrompt: () => Promise<void>;
  handleStop: () => void;
  handleReset: () => void;
  voiceActive: boolean;
  voiceStatus: VoiceStatus;
  voiceMuted: boolean;
  voiceInterimText: string;
  voiceLevel: number;
  voiceModel: string;
  toggleVoiceMode: () => Promise<void>;
  stopVoiceMode: () => Promise<void>;
  toggleVoiceMute: () => void;
  interruptVoice: () => void;
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

/**
 * Base64-encodes a UTF-8 string in the browser.
 *
 * `btoa` only accepts Latin-1, and the old `unescape(encodeURIComponent(...))`
 * trick throws a URIError on a lone surrogate — which `applyTokenLimit` can
 * produce when it truncates mid-character. `TextEncoder` replaces unpaired
 * surrogates with U+FFFD instead of throwing, so this cannot fail on any input.
 */
function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  // Chunked to stay well under the argument-count limit of String.fromCharCode.
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
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

  return encodeBase64(rawStr || '');
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
  toolsRef: { readonly current: WebMCPTool[] },
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

/**
 * A read-only view of the tools of whichever tab a turn is working with, in
 * the shape `waitForToolsToSettle` takes. It reads through to the store on
 * every access, so a turn sees the latest report for its page rather than a
 * list captured when it started — and follows the page if a tool opens one in
 * a new tab.
 */
function toolsViewFor(getTabId: () => number): { readonly current: WebMCPTool[] } {
  return {
    get current(): WebMCPTool[] {
      return tabSessions.getState(getTabId()).tools;
    },
  };
}

/**
 * The agent conversation for one tab.
 *
 * The side panel is shared by every tab in a window, so the conversation is
 * kept per tab and the panel shows the one belonging to the tab in front.
 * Switching tabs puts away that tab's messages, its progress and — the point
 * of all this — its permission prompt, instead of leaving them over a page
 * that never asked for anything. A turn that was already running keeps going
 * in the background and writes to its own tab.
 */
export function useAgentSession(
  activeTabId: number | null,
  options?: UseAgentSessionOptions
): UseAgentSessionReturn {
  // The third argument is the snapshot for a render outside a browser, which
  // is the same one: the store is plain state, not anything the DOM holds.
  const readSession = () => tabSessions.getState(activeTabId);
  const session = useSyncExternalStore(tabSessions.subscribe, readSession, readSession);
  const anyBusy = useSyncExternalStore(tabSessions.subscribe, tabSessions.isAnyBusy, tabSessions.isAnyBusy);

  // Settings sync refs
  const sensitiveActionAlertsRef = useRef<boolean>(options?.sensitiveActionAlerts ?? true);
  useEffect(() => {
    sensitiveActionAlertsRef.current = options?.sensitiveActionAlerts ?? true;
  }, [options?.sensitiveActionAlerts]);

  const onDeviceModelRef = useRef<boolean>(options?.onDeviceModel ?? false);
  useEffect(() => {
    const next = options?.onDeviceModel ?? false;
    // Switching backends starts a new conversation: neither one can carry on
    // where the other left off. That holds for every tab, not just the one in
    // front, since they all move to the new backend together.
    if (onDeviceModelRef.current !== next) {
      for (const tabId of tabSessions.tabIds()) {
        tabSessions.resetChat(tabId, { onDevice: true });
      }
      resetChatSession({ onDevice: onDeviceModelRef.current });
      clearSessionToolPermissions();
    }
    onDeviceModelRef.current = next;
  }, [options?.onDeviceModel]);

  // Read when a tool is about to run rather than when the turn started, so a
  // call that follows a navigation is judged against the page it lands on.
  const originRef = useRef<string>(options?.origin ?? '');
  useEffect(() => {
    originRef.current = options?.origin ?? '';
  }, [options?.origin]);

  // Gemini Live Voice Session state
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  const liveTabIdRef = useRef<number | null>(null);
  const [voiceActive, setVoiceActive] = useState<boolean>(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceMuted, setVoiceMuted] = useState<boolean>(false);
  const [voiceInterimText, setVoiceInterimText] = useState<string>('');
  const [voiceLevel, setVoiceLevel] = useState<number>(0);
  const [voiceModel, setVoiceModel] = useState<string>(LIVE_MODEL_ID_DEFAULT);

  const stopVoiceMode = useCallback(async () => {
    const currentSession = liveSessionRef.current;
    liveSessionRef.current = null;
    const pinnedTabId = liveTabIdRef.current;
    liveTabIdRef.current = null;
    if (currentSession) {
      await currentSession.disconnect();
    }
    if (pinnedTabId != null) {
      tabSessions.update(pinnedTabId, { streamingText: '', pendingPermission: null, busy: false });
    }
    setVoiceActive(false);
    setVoiceStatus('idle');
    setVoiceMuted(false);
    setVoiceInterimText('');
    setVoiceLevel(0);
  }, []);

  // Keep Live session notified when the active tab's WebMCP tools change dynamically
  useEffect(() => {
    if (voiceActive && liveSessionRef.current && activeTabId != null) {
      liveSessionRef.current.notifyToolsUpdated(session.tools);
    }
  }, [voiceActive, activeTabId, session.tools]);

  // Cleanup in-flight requests on unmount: the panel is closing, and nothing
  // is left to show a reply to.
  useEffect(() => {
    return () => {
      void liveSessionRef.current?.disconnect();
      liveSessionRef.current = null;
      for (const tabId of tabSessions.tabIds()) {
        tabSessions.getInternals(tabId).abortController?.abort();
        tabSessions.update(tabId, { pendingPermission: null, busy: false });
      }
      clearSessionToolPermissions();
    };
  }, []);

  const setUserPrompt = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      if (activeTabId == null) return;
      tabSessions.update(activeTabId, (previous) => ({
        userPrompt: typeof value === 'function' ? value(previous.userPrompt) : value,
      }));
    },
    [activeTabId]
  );

  // Dedicated cancellation handler
  const handleStop = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.interrupt();
    }
    if (activeTabId == null) return;
    const internals = tabSessions.getInternals(activeTabId);
    if (internals.abortController) {
      internals.abortController.abort();
      internals.abortController = null;
    }
    // What was written before the stop stays, rather than vanishing.
    const partial = tabSessions.getState(activeTabId).streamingText.trim();
    const logs = [...internals.turnLogs];
    tabSessions.update(activeTabId, (previous) => ({
      messages: partial
        ? [
            ...previous.messages,
            { id: generateId(), role: 'ai', text: partial, activityLogs: logs, onDevice: onDeviceModelRef.current },
          ]
        : previous.messages,
      streamingText: '',
      pendingPermission: null,
      busy: false,
    }));
  }, [activeTabId]);

  // Reset chat session state
  const handleReset = useCallback(() => {
    // A new chat asks again: permission was given for the conversation the
    // user was having, not for every one that follows it.
    if (liveSessionRef.current) {
      void stopVoiceMode();
    }
    if (activeTabId == null) return;
    tabSessions.resetChat(activeTabId, { onDevice: onDeviceModelRef.current });
  }, [activeTabId, stopVoiceMode]);

  const toggleVoiceMute = useCallback(() => {
    if (!liveSessionRef.current) return;
    const nextMuted = !liveSessionRef.current.isMuted();
    liveSessionRef.current.setMuted(nextMuted);
    setVoiceMuted(nextMuted);
  }, []);

  const interruptVoice = useCallback(() => {
    liveSessionRef.current?.interrupt();
    if (activeTabId != null) {
      tabSessions.update(activeTabId, { streamingText: '' });
    }
  }, [activeTabId]);

  const createTurnToolExecutor = useCallback(
    (options: {
      tabId: number;
      startOrigin: string;
      onDevice: boolean;
      signal?: AbortSignal;
    }) => {
      const { tabId, startOrigin, onDevice, signal } = options;
      const internals = tabSessions.getInternals(tabId);
      let turnTabId = tabId;
      const toolsView = toolsViewFor(() => turnTabId);

      const currentOrigin = () => {
        const tabState = tabSessions.getState(turnTabId);
        if (tabState.origin || tabState.domain) return tabState.origin;
        return turnTabId === tabId ? startOrigin : '';
      };

      const logActivity = (name: string): ActivityEntry => {
        const entry: ActivityEntry = {
          id: generateId(),
          name,
          done: false,
        };
        internals.turnLogs = [entry, ...internals.turnLogs];
        tabSessions.update(tabId, (previous) => ({ activityLog: [entry, ...previous.activityLog] }));
        return entry;
      };

      const completeActivity = (entry: ActivityEntry) => {
        const update = (item: ActivityEntry) => (item.id === entry.id ? { ...item, done: true } : item);
        internals.turnLogs = internals.turnLogs.map(update);
        tabSessions.update(tabId, (previous) => ({ activityLog: previous.activityLog.map(update) }));
      };

      const executeCalls = async (
        calls: Array<{ id?: string; name: string; args: Record<string, unknown> }>
      ): Promise<LiveFunctionResponse[]> => {
        const responses: LiveFunctionResponse[] = [];
        for (const call of calls) {
          if (signal?.aborted) break;
          const { name, frameId } = decodeToolName(call.name);
          const targetTool =
            frameId !== undefined
              ? toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === frameId)
              : toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === 0) ||
                toolsView.current.find((t) => t.name === name);

          if (!targetTool) {
            responses.push({
              id: call.id || call.name,
              name: call.name,
              response: { error: `Tool "${name}" is not available on this page.` },
            });
            continue;
          }

          const entry = logActivity(name);
          const toolName = targetTool.name;
          const origin = currentOrigin();
          const toolFrameId = frameId ?? targetTool.frameId ?? 0;
          const permissionQuery = {
            sensitiveActionAlerts: sensitiveActionAlertsRef.current,
            origin,
            toolName,
            tabId,
            readOnlyHint: targetTool.readOnlyHint,
            consequentialHint: targetTool.consequentialHint,
            toolFrameId,
          };
          const grantEligible = isGrantEligible(permissionQuery);
          const needsPermission = needsToolPermission(permissionQuery);

          if (needsPermission) {
            const decision = await new Promise<ToolPermissionDecision>((resolve) => {
              const clearPrompt = () => tabSessions.update(tabId, { pendingPermission: null });
              const onAbort = () => {
                signal?.removeEventListener('abort', onAbort);
                clearPrompt();
                resolve('deny');
              };

              if (signal?.aborted) {
                resolve('deny');
                return;
              }

              signal?.addEventListener('abort', onAbort, { once: true });

              const settle = (outcome: ToolPermissionDecision) => () => {
                signal?.removeEventListener('abort', onAbort);
                clearPrompt();
                resolve(outcome);
              };

              tabSessions.update(tabId, {
                pendingPermission: {
                  toolName,
                  toolDescription: targetTool?.description,
                  origin: origin || undefined,
                  consequential: targetTool?.consequentialHint === true,
                  allow: settle('allow'),
                  allowAlways: grantEligible ? settle('allowAlways') : undefined,
                  deny: settle('deny'),
                },
              });
            });

            if (signal?.aborted) break;

            const latestOrigin = currentOrigin();
            if (latestOrigin !== origin) {
              completeActivity(entry);
              responses.push({
                id: call.id || call.name,
                name: call.name,
                response: { error: 'Page origin changed before tool execution was approved.' },
              });
              continue;
            }

            if (!applyToolPermissionDecision(decision, permissionQuery)) {
              completeActivity(entry);
              responses.push({
                id: call.id || call.name,
                name: call.name,
                response: { error: 'User denied permission to execute this tool.' },
              });
              continue;
            }
          }

          try {
            let movedToNewTab = false;
            const rawRes = await executeTabTool(name, call.args, toolFrameId, turnTabId, {
              onTabChanged: (movedTabId) => {
                turnTabId = movedTabId;
                movedToNewTab = true;
              },
            });
            if (signal?.aborted) break;
            if (movedToNewTab) {
              const movedInfo = await getTabInfo(turnTabId);
              if (movedInfo) {
                tabSessions.update(turnTabId, (prev) => ({
                  domain: movedInfo.domain || prev.domain,
                  origin: movedInfo.url ? originOfUrl(movedInfo.url) : prev.origin,
                  favicon: movedInfo.favicon || prev.favicon,
                }));
              }
            }

            const limitedRes = applyTokenLimit(rawRes);
            const res = applySpotlighting(limitedRes, targetTool, getSpotlighting(onDevice));
            completeActivity(entry);
            responses.push({
              id: call.id || call.name,
              name: call.name,
              response: { result: res },
            });
          } catch (err: unknown) {
            if (signal?.aborted) break;
            const errorMsg = (err as Error)?.message || String(err);
            completeActivity(entry);
            responses.push({
              id: call.id || call.name,
              name: call.name,
              response: { error: errorMsg },
            });
          }
        }

        if (!signal?.aborted) {
          await waitForToolsToSettle(toolsView, {
            requestTools: () => requestTabTools(turnTabId),
            signal,
          });
        }
        return responses;
      };

      return { toolsView, executeCalls };
    },
    []
  );

  const toggleVoiceMode = useCallback(async () => {
    if (liveSessionRef.current || voiceActive) {
      await stopVoiceMode();
      return;
    }

    const tabId = activeTabId;
    if (tabId == null) return;

    const internals = tabSessions.getInternals(tabId);
    if (!internals.chatId) {
      internals.chatId = crypto.randomUUID();
    }

    const { toolsView, executeCalls } = createTurnToolExecutor({
      tabId,
      startOrigin: originRef.current,
      onDevice: false,
    });

    const executeLiveTools = async (calls: LiveToolCall[]): Promise<LiveFunctionResponse[]> => {
      const responses = await executeCalls(calls);
      liveSessionRef.current?.notifyToolsUpdated(toolsView.current);
      return responses;
    };

    const liveSession = new GeminiLiveSession({
      onStatusChange: (nextStatus) => {
        setVoiceStatus(nextStatus);
        setVoiceActive(nextStatus !== 'idle' && nextStatus !== 'error');
      },
      onUserInterim: (text) => {
        setVoiceInterimText(text);
      },
      onUserCommit: (text) => {
        setVoiceInterimText('');
        tabSessions.update(tabId, (previous) => ({
          activityLog: [],
          messages: [...previous.messages, { id: generateId(), role: 'user', text }],
        }));
        internals.chatId = syncDirectGeminiHistory(internals.chatId, [{ role: 'user', content: text }]);
      },
      onAgentStream: (text) => {
        tabSessions.update(tabId, { streamingText: text });
      },
      onAgentCommit: (text) => {
        const logs = [...internals.turnLogs];
        internals.turnLogs = [];
        tabSessions.update(tabId, (previous) => ({
          streamingText: '',
          messages: [
            ...previous.messages,
            {
              id: generateId(),
              role: 'ai',
              text,
              activityLogs: logs,
              onDevice: false,
            },
          ],
        }));
        internals.chatId = syncDirectGeminiHistory(internals.chatId, [
          { role: 'assistant', content: text },
        ]);
      },
      onToolCall: executeLiveTools,
      onLevelChange: (level) => {
        setVoiceLevel(level);
      },
      onError: (errorMessage) => {
        tabSessions.update(tabId, (previous) => ({
          streamingText: '',
          messages: [
            ...previous.messages,
            {
              id: generateId(),
              role: 'error',
              text: formatErrorMessage(errorMessage),
            },
          ],
        }));
        void stopVoiceMode();
      },
    });

    liveSessionRef.current = liveSession;
    liveTabIdRef.current = tabId;
    setVoiceActive(true);
    setVoiceStatus('connecting');

    try {
      const currentState = tabSessions.getState(tabId);
      await liveSession.connect({
        tools: currentState.tools,
        priorMessages: currentState.messages,
      });
      setVoiceModel(liveSession.getModel());
    } catch (err: unknown) {
      const errorText = formatErrorMessage(err);
      tabSessions.update(tabId, (previous) => ({
        messages: [
          ...previous.messages,
          {
            id: generateId(),
            role: 'error',
            text: `Voice Mode error: ${errorText}`,
          },
        ],
      }));
      await stopVoiceMode();
    }
  }, [activeTabId, createTurnToolExecutor, stopVoiceMode, voiceActive]);

  // Main prompt sending logic via backend (or into active Gemini Live session)
  const handleSendPrompt = useCallback(async () => {
    // The tab is pinned for the whole turn. Everything below writes to it and
    // runs tools against it, however many times the user switches tabs while
    // it is working.
    const tabId = activeTabId;
    if (tabId == null) return;

    const state = tabSessions.getState(tabId);
    if (state.busy) return;

    const textToSend = state.userPrompt.trim();
    if (!textToSend) return;

    // If Gemini Live voice mode is active, send the typed turn directly into the
    // active Live session so voice and text share the exact same live conversation.
    if (liveSessionRef.current && liveSessionRef.current.sendText(textToSend)) {
      const internals = tabSessions.getInternals(tabId);
      tabSessions.update(tabId, (previous) => ({
        userPrompt: '',
        activityLog: [],
        messages: [...previous.messages, { id: generateId(), role: 'user', text: textToSend }],
      }));
      internals.chatId = syncDirectGeminiHistory(internals.chatId, [
        { role: 'user', content: textToSend },
      ]);
      return;
    }

    // The browser holds a single on-device session, so two tabs cannot be
    // mid-turn on it at once. Saying so beats quietly wrecking both.
    if (onDeviceModelRef.current && tabSessions.busyTabIds().some((busyTabId) => busyTabId !== tabId)) {
      tabSessions.update(tabId, (previous) => ({
        messages: [
          ...previous.messages,
          {
            id: generateId(),
            role: 'error',
            text: 'The on-device model can only answer one tab at a time. Wait for the reply in the other tab to finish, or stop it.',
          },
        ],
      }));
      return;
    }

    const internals = tabSessions.getInternals(tabId);
    // Initialize turn abort controller
    internals.abortController?.abort();
    const abortController = new AbortController();
    internals.abortController = abortController;
    const { signal } = abortController;
    // Replies are shown as they are written, and become messages once done.
    const showStreamingText = (text: string) => tabSessions.update(tabId, { streamingText: text });
    const onText = (text: string) => {
      if (!signal.aborted) showStreamingText(text);
    };

    const { toolsView, executeCalls } = createTurnToolExecutor({
      tabId,
      startOrigin: originRef.current,
      onDevice: onDeviceModelRef.current,
      signal,
    });

    const addMessage = (message: ChatMessage) =>
      tabSessions.update(tabId, (previous) => ({ messages: [...previous.messages, message] }));

    internals.turnLogs = [];
    if (!internals.chatId) {
      internals.chatId = crypto.randomUUID();
    }
    tabSessions.update(tabId, (previous) => ({
      busy: true,
      userPrompt: '',
      pendingPermission: null,
      activityLog: [],
      messages: [...previous.messages, { id: generateId(), role: 'user', text: textToSend }],
    }));

    try {
      const toolDecls = buildToolDecls(toolsView.current);
      let currentResult: ChatTurnResponse = await sendChatTurn(
        {
          message: textToSend,
          tools: toolDecls,
          chatId: internals.chatId,
        },
        { signal, onDevice: onDeviceModelRef.current, onText }
      );

      if (signal.aborted) return;
      // Batched with the message the text becomes, so nothing flickers.
      showStreamingText('');

      if (currentResult.chatId) {
        internals.chatId = currentResult.chatId;
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
          const logs = [...internals.turnLogs];
          internals.turnLogs = [];
          addMessage({
            id: generateId(),
            role: 'ai',
            text: currentResult.text.trim(),
            activityLogs: logs,
            onDevice: onDeviceModelRef.current,
          });
          messageRendered = true;
        }

        const executedResponses = await executeCalls(currentResult.functionCalls);
        if (signal.aborted) break;

        const toolResponses = executedResponses.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: r.response,
          },
        }));

        const updatedTools = buildToolDecls(toolsView.current);

        currentResult = await sendChatTurn(
          {
            toolResponses,
            tools: updatedTools,
            chatId: internals.chatId,
          },
          { signal, onDevice: onDeviceModelRef.current, onText }
        );

        if (signal.aborted) break;
        showStreamingText('');

        if (currentResult.chatId) {
          internals.chatId = currentResult.chatId;
        }
      }

      if (signal.aborted) return;

      if (currentResult.text?.trim()) {
        const logs = [...internals.turnLogs];
        addMessage({
          id: generateId(),
          role: 'ai',
          text: currentResult.text.trim(),
          activityLogs: logs,
          onDevice: onDeviceModelRef.current,
        });
      } else if (messageRendered && internals.turnLogs.length > 0) {
        const trailingLogs = [...internals.turnLogs];
        tabSessions.update(tabId, (previous) => {
          const updated = [...previous.messages];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === 'ai') {
              updated[i] = {
                ...updated[i],
                activityLogs: [...trailingLogs, ...(updated[i].activityLogs ?? [])],
              };
              break;
            }
          }
          return { messages: updated };
        });
      } else if (!messageRendered) {
        addMessage({
          id: generateId(),
          role: 'error',
          text: 'I couldn’t generate a response for that request. Please try again.',
        });
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      showStreamingText('');
      const formatted = formatErrorMessage(err);
      console.error('[WebMCP] Error during chat turn:', formatted, err);
      addMessage({
        id: generateId(),
        role: 'error',
        text:
          err instanceof UserFacingError
            ? err.message
            : 'Something went wrong while processing your request. Please try again.',
      });
      if (internals.chatId) {
        resetChatSession({ chatId: internals.chatId, onDevice: onDeviceModelRef.current });
        internals.chatId = undefined;
      }
    } finally {
      if (!signal.aborted) {
        tabSessions.update(tabId, { pendingPermission: null, busy: false });
        if (internals.abortController === abortController) {
          internals.abortController = null;
        }
      }
    }
  }, [activeTabId]);

  return {
    userPrompt: session.userPrompt,
    setUserPrompt,
    messages: session.messages,
    streamingText: session.streamingText,
    busy: session.busy,
    anyBusy,
    activityLog: session.activityLog,
    pendingPermission: session.pendingPermission,
    handleSendPrompt,
    handleStop,
    handleReset,
    voiceActive,
    voiceStatus,
    voiceMuted,
    voiceInterimText,
    voiceLevel,
    voiceModel,
    toggleVoiceMode,
    stopVoiceMode,
    toggleVoiceMute,
    interruptVoice,
  };
}

