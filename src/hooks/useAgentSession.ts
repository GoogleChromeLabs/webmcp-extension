/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { formatErrorMessage } from '../services/backendBridge.js';
import { getSpotlighting, resetChatSession, sendChatTurn } from '../services/chatBridge.js';
import { executeTabTool, getTabInfo, requestTabTools } from '../services/extensionBridge.js';
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

/** Re-exported for callers of this hook; defined with the permission rules. */
export type { PendingToolPermission, ToolPermissionDecision };

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

/**
 * A read-only view of the tools of whichever tab a turn is working with, in
 * the shape `waitForToolsToSettle` takes. It reads through to the store on
 * every access, so a turn sees the latest report for its page rather than a
 * list captured when it started — and follows the page if a tool opens one in
 * a new tab.
 */
function toolsViewFor(getTabId: () => number): MutableRefObject<WebMCPTool[]> {
  return {
    get current(): WebMCPTool[] {
      return tabSessions.getState(getTabId()).tools;
    },
    // Tools only ever come from the page's own reports.
    set current(_tools: WebMCPTool[]) {},
  } as MutableRefObject<WebMCPTool[]>;
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
  tabIdOrTools: number | null | WebMCPTool[] | MutableRefObject<WebMCPTool[]>,
  options?: UseAgentSessionOptions
): UseAgentSessionReturn {
  const activeTabId =
    typeof tabIdOrTools === 'number' ? tabIdOrTools : tabIdOrTools === null ? null : 1;

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
        const internals = tabSessions.getInternals(tabId);
        resetChatSession({ chatId: internals.chatId, onDevice: onDeviceModelRef.current });
        internals.chatId = undefined;
      }
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

  // Cleanup in-flight requests on unmount: the panel is closing, and nothing
  // is left to show a reply to.
  useEffect(() => {
    return () => {
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
    clearSessionToolPermissions(activeTabId ?? undefined);
    if (activeTabId == null) return;
    const internals = tabSessions.getInternals(activeTabId);
    if (internals.abortController) {
      internals.abortController.abort();
      internals.abortController = null;
    }
    if (internals.chatId) {
      resetChatSession({ chatId: internals.chatId, onDevice: onDeviceModelRef.current });
      internals.chatId = undefined;
    }
    internals.turnLogs = [];
    tabSessions.update(activeTabId, {
      userPrompt: '',
      messages: [],
      activityLog: [],
      streamingText: '',
      pendingPermission: null,
      busy: false,
    });
  }, [activeTabId]);

  // Main prompt sending logic via backend
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
    // The conversation stays on `tabId`, where the user can see it, but the
    // page being worked on can move: a tool may open a tab of its own and the
    // flow carries on there.
    let turnTabId = tabId;
    const startOrigin = originRef.current;
    const toolsView = toolsViewFor(() => turnTabId);
    const currentOrigin = () => {
      const tabState = tabSessions.getState(turnTabId);
      if (tabState.origin || tabState.domain) return tabState.origin;
      return turnTabId === tabId ? startOrigin : '';
    };

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

    // Activity logger helpers, scoped to this turn's tab.
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
      internals.turnLogs = [entry, ...internals.turnLogs];
      tabSessions.update(tabId, (previous) => ({ activityLog: [entry, ...previous.activityLog] }));
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

      internals.turnLogs = internals.turnLogs.map(update);
      tabSessions.update(tabId, (previous) => ({ activityLog: previous.activityLog.map(update) }));
    };

    const addMessage = (message: ChatMessage) =>
      tabSessions.update(tabId, (previous) => ({ messages: [...previous.messages, message] }));

    internals.turnLogs = [];
    if (onDeviceModelRef.current && !internals.chatId) {
      internals.chatId = crypto.randomUUID();
    }
    tabSessions.update(tabId, (previous) => ({
      busy: true,
      userPrompt: '',
      pendingPermission: null,
      activityLog: [],
      messages: [...previous.messages, { id: generateId(), role: 'user', text: textToSend, meta: 'you' }],
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
          addMessage({
            id: generateId(),
            role: 'ai',
            text: currentResult.text.trim(),
            activityLogs: logs,
            onDevice: onDeviceModelRef.current,
          });
          messageRendered = true;
        }

        const toolResponses = [];
        for (const call of currentResult.functionCalls) {
          if (signal.aborted) break;
          const { name, frameId } = decodeToolName(call.name);
          // Find the tool declaration among this tab's tools without crossing frame boundaries
          const targetTool =
            frameId !== undefined
              ? toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === frameId)
              : toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === 0) ||
                toolsView.current.find((t) => t.name === name);



          if (!targetTool) {
            const errorMsg = `Tool "${name}" is not available on this page.`;
            toolResponses.push({
              functionResponse: {
                name: call.name,
                response: { error: errorMsg },
              },
            });
            continue;
          }

          const entry = logActivity('assistant', name, call.args);

          const toolName = targetTool.name;
          const origin = currentOrigin();
          // Explicit frameId from the tool call takes precedence over fallback tool metadata.
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

          // If sensitive action alerts is enabled and tool is not readonly, prompt the user before execution
          if (needsPermission) {
            const decision = await new Promise<ToolPermissionDecision>((resolve) => {
              const clearPrompt = () => tabSessions.update(tabId, { pendingPermission: null });
              const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                clearPrompt();
                resolve('deny');
              };

              if (signal.aborted) {
                resolve('deny');
                return;
              }

              signal.addEventListener('abort', onAbort, { once: true });

              const settle = (outcome: ToolPermissionDecision) => () => {
                signal.removeEventListener('abort', onAbort);
                clearPrompt();
                resolve(outcome);
              };

              // Filed under this turn's tab, so it is only on screen while
              // that tab is in front.
              tabSessions.update(tabId, {
                pendingPermission: {
                  toolName,
                  toolDescription: targetTool?.description,
                  args: call.args,
                  origin: origin || undefined,
                  consequential: targetTool?.consequentialHint === true,
                  allow: settle('allow'),
                  // Only offered where the grant would mean what the button says:
                  // a known tool, in the top frame, of a page with an origin, and
                  // never for something that may be irreversible.
                  allowAlways: grantEligible ? settle('allowAlways') : undefined,
                  deny: settle('deny'),
                },
              });
            });

            if (signal.aborted) break;

            // Verify that the tab has not navigated to a different origin while awaiting permission.
            const latestOrigin = currentOrigin();
            if (latestOrigin !== origin) {
              completeActivity(entry, { error: 'Origin changed while waiting for permission' });
              toolResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { error: 'Page origin changed before tool execution was approved.' },
                },
              });
              continue;
            }

            if (!applyToolPermissionDecision(decision, permissionQuery)) {
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
            let movedToNewTab = false;
            const rawRes = await executeTabTool(name, call.args, toolFrameId, turnTabId, {
              onTabChanged: (movedTabId) => {
                turnTabId = movedTabId;
                movedToNewTab = true;
              },
            });
            if (signal.aborted) break;
            if (movedToNewTab) {
              const movedInfo = await getTabInfo(turnTabId);
              if (movedInfo) {
                tabSessions.update(turnTabId, (prev) => ({
                  domain: movedInfo.domain || prev.domain,
                  origin: originOfUrl(movedInfo.url || '') || prev.origin,
                  favicon: movedInfo.favicon || prev.favicon,
                }));
              }
            }

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

        await waitForToolsToSettle(toolsView, {
          requestTools: () => requestTabTools(turnTabId),
          signal,
        });
        if (signal.aborted) break;

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
      } else if (!messageRendered && (!currentResult.functionCalls || currentResult.functionCalls.length === 0)) {
        addMessage({ id: generateId(), role: 'error', text: 'The model returned an empty response.' });
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      showStreamingText('');
      console.error('[WebMCP] Error during chat turn:', formatErrorMessage(err), err);
      addMessage({
        id: generateId(),
        role: 'error',
        text: 'Something went wrong while processing your request. The error details have been logged.',
      });
      internals.chatId = undefined;
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
  };
}

export default useAgentSession;
