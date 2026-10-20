/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { formatErrorMessage } from '../services/backendBridge.js';
import { endChat, getSpotlighting, sendChatTurn } from '../services/chatBridge.js';
import { executeTabTool, getTabInfo, requestTabTools } from '../services/extensionBridge.js';
import { tabSessions } from '../services/tabSessionStore.js';
import { buildToolDecls, decodeToolName } from '../services/toolEncoder.js';
import {
  applyToolPermissionDecision,
  clearSessionToolPermissions,
  isGrantEligible,
  needsToolPermission,
  originOfUrl,
  type ToolPermissionDecision,
} from '../services/toolPermissions.js';
import { applySpotlighting, applyTokenLimit, waitForToolsToSettle } from '../services/toolResults.js';
import { DEFAULT_TOOL_ROUND_LIMITS, ToolRoundLimitError, type ToolRoundLimits } from '../services/toolRoundLimits.js';
import {
  type ActivityEntry,
  type ChatMessage,
  type ChatTurnRequest,
  type ChatTurnResponse,
  type PendingToolCheckpoint,
  type PendingToolPermission,
  UserFacingError,
  type WebMCPTool,
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
  /**
   * When a request asks once before using more tools, and the most it may use.
   * Defaults to `DEFAULT_TOOL_ROUND_LIMITS`. The on-device model always stops
   * at the default `max`, so a higher `max` only holds on the server.
   */
  toolRoundLimits?: ToolRoundLimits;
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
  /** Set while the agent waits for the user to let it keep using tools. */
  pendingCheckpoint: PendingToolCheckpoint | null;
  handleSendPrompt: () => Promise<void>;
  handleStop: () => void;
  handleReset: () => void;
}

let nextId = Date.now();
const generateId = (): number => ++nextId;

/**
 * Transfers pending activity to the conversation, even without model text.
 * Each transfer appends a message so activity stays after any earlier text.
 * Logs are drained so stopping or finishing again cannot duplicate them.
 */
function persistTurnOutput(tabId: number, text: string, onDevice: boolean): void {
  const internals = tabSessions.getInternals(tabId);
  const logs = internals.turnLogs;
  const reply = text.trim();
  if (!reply && logs.length === 0) return;

  internals.turnLogs = [];
  const message: ChatMessage = {
    id: generateId(),
    role: 'ai',
    text: reply,
    activityLogs: logs,
    onDevice,
  };
  tabSessions.update(tabId, (previous) => ({ messages: [...previous.messages, message] }));
}

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

/** One entry of the `toolResponses` a turn sends back to the model. */
type ToolResponse = NonNullable<ChatTurnRequest['toolResponses']>[number];

function toolResponse(
  call: { id?: string; name: string },
  response: ToolResponse['functionResponse']['response']
): ToolResponse {
  return { functionResponse: { id: call.id, name: call.name, response } };
}

/**
 * Shows a prompt and waits for the user's answer. Every prompt the agent waits
 * on goes through here, so they all behave the same: `show` files it under the
 * turn's tab and hands each choice its own callback, answering clears it with
 * `hide`, and stopping the turn clears it and counts as `answerOnStop`.
 */
function waitForAnswer<T>(
  signal: AbortSignal,
  answerOnStop: T,
  show: (answer: (value: T) => () => void) => void,
  hide: () => void
): Promise<T> {
  return new Promise<T>((resolve) => {
    if (signal.aborted) {
      resolve(answerOnStop);
      return;
    }
    const onAbort = () => {
      hide();
      resolve(answerOnStop);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    show((value) => () => {
      signal.removeEventListener('abort', onAbort);
      hide();
      resolve(value);
    });
  });
}

/**
 * Shows a permission prompt under `tabId` and waits for the user's answer.
 * Stopping the turn clears the prompt and counts as a denial.
 */
function askToolPermission(
  tabId: number,
  signal: AbortSignal,
  prompt: Omit<PendingToolPermission, 'allow' | 'allowAlways' | 'deny'> & { canAllowAlways: boolean }
): Promise<ToolPermissionDecision> {
  const { canAllowAlways, ...details } = prompt;
  return waitForAnswer<ToolPermissionDecision>(
    signal,
    'deny',
    (settle) =>
      // Filed under this turn's tab, so it is only on screen while that tab is
      // in front.
      tabSessions.update(tabId, {
        pendingPermission: {
          ...details,
          allow: settle('allow'),
          // Only offered where the grant would mean what the button says: a
          // known tool, in the top frame, of a page with an origin, and never
          // for something that may be irreversible.
          allowAlways: canAllowAlways ? settle('allowAlways') : undefined,
          deny: settle('deny'),
        },
      }),
    () => tabSessions.update(tabId, { pendingPermission: null })
  );
}

/**
 * Asks under `tabId` whether the agent may keep using tools, and waits for the
 * answer: true to go on. It works like a permission prompt, in the same place,
 * and stopping the turn clears it and counts as a no.
 */
function askToContinue(
  tabId: number,
  signal: AbortSignal,
  details: Omit<PendingToolCheckpoint, 'allow' | 'deny'>
): Promise<boolean> {
  return waitForAnswer<boolean>(
    signal,
    false,
    (settle) =>
      tabSessions.update(tabId, {
        pendingCheckpoint: { ...details, allow: settle(true), deny: settle(false) },
      }),
    () => tabSessions.update(tabId, { pendingCheckpoint: null })
  );
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
      // Each chat is ended on the backend that was holding it.
      for (const tabId of tabSessions.tabIds()) {
        tabSessions.resetChat(tabId, { onDevice: onDeviceModelRef.current });
      }
    }
    onDeviceModelRef.current = next;
  }, [options?.onDeviceModel]);

  // Read when a tool is about to run rather than when the turn started, so a
  // call that follows a navigation is judged against the page it lands on.
  const originRef = useRef<string>(options?.origin ?? '');
  useEffect(() => {
    originRef.current = options?.origin ?? '';
  }, [options?.origin]);

  // Read when a turn starts: a turn keeps the limits it began with.
  const toolRoundLimitsRef = useRef<ToolRoundLimits>(options?.toolRoundLimits ?? DEFAULT_TOOL_ROUND_LIMITS);
  useEffect(() => {
    toolRoundLimitsRef.current = options?.toolRoundLimits ?? DEFAULT_TOOL_ROUND_LIMITS;
  }, [options?.toolRoundLimits]);

  // Cleanup in-flight requests on unmount: the panel is closing, and nothing
  // is left to show a reply to.
  useEffect(() => {
    return () => {
      for (const tabId of tabSessions.tabIds()) {
        tabSessions.getInternals(tabId).abortController?.abort();
        tabSessions.update(tabId, { pendingPermission: null, pendingCheckpoint: null, busy: false });
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
    if (activeTabId == null || !tabSessions.getState(activeTabId).busy) return;
    const internals = tabSessions.getInternals(activeTabId);
    if (internals.abortController) {
      internals.abortController.abort();
      internals.abortController = null;
    }
    persistTurnOutput(activeTabId, tabSessions.getState(activeTabId).streamingText, onDeviceModelRef.current);
    tabSessions.update(activeTabId, {
      streamingText: '',
      pendingPermission: null,
      pendingCheckpoint: null,
      busy: false,
    });
  }, [activeTabId]);

  // Reset chat session state
  const handleReset = useCallback(() => {
    // A new chat asks again: permission was given for the conversation the
    // user was having, not for every one that follows it.
    if (activeTabId == null) return;
    tabSessions.resetChat(activeTabId, { onDevice: onDeviceModelRef.current });
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
      if (signal.aborted || internals.abortController !== abortController) return;
      const update = (item: ActivityEntry) => (item.id === entry.id ? { ...item, done: true } : item);

      internals.turnLogs = internals.turnLogs.map(update);
      tabSessions.update(tabId, (previous) => ({ activityLog: previous.activityLog.map(update) }));
    };

    const addMessage = (message: ChatMessage) =>
      tabSessions.update(tabId, (previous) => ({ messages: [...previous.messages, message] }));

    const limits = toolRoundLimitsRef.current;

    internals.turnLogs = [];
    if (!internals.chatId) {
      internals.chatId = crypto.randomUUID();
    }
    tabSessions.update(tabId, (previous) => ({
      busy: true,
      userPrompt: '',
      pendingPermission: null,
      pendingCheckpoint: null,
      activityLog: [],
      messages: [...previous.messages, { id: generateId(), role: 'user', text: textToSend }],
    }));

    /**
     * Runs one tool call the model asked for: finds the tool, asks the user
     * when the rules say so, runs it on the page, and prepares the result for
     * the model. Returns null when the turn was stopped along the way.
     */
    const runToolCall = async (
      call: NonNullable<ChatTurnResponse['functionCalls']>[number]
    ): Promise<ToolResponse | null> => {
      const { name, frameId } = decodeToolName(call.name);
      // Find the tool declaration among this tab's tools without crossing frame boundaries
      const targetTool =
        frameId !== undefined
          ? toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === frameId)
          : toolsView.current.find((t) => t.name === name && (t.frameId ?? 0) === 0) ||
            toolsView.current.find((t) => t.name === name);

      if (!targetTool) {
        return toolResponse(call, { error: `Tool "${name}" is not available on this page.` });
      }

      const entry = logActivity(name);
      const origin = currentOrigin();
      // Explicit frameId from the tool call takes precedence over fallback tool metadata.
      const toolFrameId = frameId ?? targetTool.frameId ?? 0;
      const permissionQuery = {
        sensitiveActionAlerts: sensitiveActionAlertsRef.current,
        origin,
        toolName: targetTool.name,
        tabId,
        readOnlyHint: targetTool.readOnlyHint,
        consequentialHint: targetTool.consequentialHint,
        toolFrameId,
      };

      if (needsToolPermission(permissionQuery)) {
        const decision = await askToolPermission(tabId, signal, {
          toolName: targetTool.name,
          toolDescription: targetTool.description,
          origin: origin || undefined,
          consequential: targetTool.consequentialHint === true,
          canAllowAlways: isGrantEligible(permissionQuery),
        });
        if (signal.aborted) return null;

        // Verify that the tab has not navigated to a different origin while awaiting permission.
        if (currentOrigin() !== origin) {
          completeActivity(entry);
          return toolResponse(call, { error: 'Page origin changed before tool execution was approved.' });
        }
        if (!applyToolPermissionDecision(decision, permissionQuery)) {
          completeActivity(entry);
          return toolResponse(call, { error: 'User denied permission to execute this tool.' });
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
        if (signal.aborted) return null;
        if (movedToNewTab) {
          const movedInfo = await getTabInfo(turnTabId);
          if (signal.aborted) return null;
          if (movedInfo) {
            tabSessions.update(turnTabId, (prev) => ({
              domain: movedInfo.domain || prev.domain,
              origin: movedInfo.url ? originOfUrl(movedInfo.url) : prev.origin,
              favicon: movedInfo.favicon || prev.favicon,
            }));
          }
        }

        const res = applySpotlighting(
          applyTokenLimit(rawRes),
          targetTool,
          getSpotlighting(onDeviceModelRef.current)
        );

        // Security Note: This is where you might utilize a prompt injection classifier to
        // detect any prompt injection in the tool output before returning it to the model.
        completeActivity(entry);
        return toolResponse(call, { result: res });
      } catch (err: unknown) {
        if (signal.aborted) return null;
        completeActivity(entry);
        return toolResponse(call, { error: (err as Error)?.message || String(err) });
      }
    };

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
      // Rounds of tool calls run so far: replies that asked for tools, however
      // many each one asked for at once.
      let roundsUsed = 0;
      let stoppedByUser = false;
      // Set when the request has used up its rounds: by the check below, or
      // by the on-device backend's own cap.
      let limitReached: ToolRoundLimitError | null = null;

      while (
        currentResult.functionCalls &&
        currentResult.functionCalls.length > 0 &&
        !signal.aborted
      ) {
        if (currentResult.text?.trim()) {
          persistTurnOutput(tabId, currentResult.text, onDeviceModelRef.current);
          messageRendered = true;
        }

        if (roundsUsed >= limits.max) {
          limitReached = new ToolRoundLimitError(limits.max);
          break;
        }
        // Asked once, after what the model said, so the user can see what it
        // is about to do.
        if (roundsUsed === limits.askAfter) {
          const keepGoing = await askToContinue(tabId, signal, { roundsUsed, maxRounds: limits.max });
          if (signal.aborted) break;
          if (!keepGoing) {
            stoppedByUser = true;
            break;
          }
        }

        const toolResponses: ToolResponse[] = [];
        for (const call of currentResult.functionCalls) {
          if (signal.aborted) break;
          const response = await runToolCall(call);
          if (response) toolResponses.push(response);
        }

        if (signal.aborted) break;

        await waitForToolsToSettle(toolsView, {
          requestTools: () => requestTabTools(turnTabId),
          signal,
        });
        if (signal.aborted) break;

        const updatedTools = buildToolDecls(toolsView.current);

        try {
          currentResult = await sendChatTurn(
            {
              toolResponses,
              tools: updatedTools,
              chatId: internals.chatId,
            },
            { signal, onDevice: onDeviceModelRef.current, onText }
          );
        } catch (err: unknown) {
          // The on-device backend has its own cap on rounds, set to the same
          // number, `DEFAULT_TOOL_ROUND_LIMITS.max`. It also counts calls it
          // refuses by itself, such as a tool that does not exist, and those
          // never reach this loop. So it can reach the cap first. Then the
          // turn ends here, the same way as at the check above.
          if (signal.aborted || !(err instanceof ToolRoundLimitError)) throw err;
          persistTurnOutput(tabId, tabSessions.getState(tabId).streamingText, onDeviceModelRef.current);
          showStreamingText('');
          limitReached = err;
          break;
        }
        roundsUsed++;

        if (signal.aborted) break;
        showStreamingText('');

        if (currentResult.chatId) {
          internals.chatId = currentResult.chatId;
        }
      }

      if (signal.aborted) return;

      const stopped = stoppedByUser || limitReached !== null;
      const reply = stopped ? '' : currentResult.text ?? '';
      persistTurnOutput(tabId, reply, onDeviceModelRef.current);
      if (!messageRendered && !reply.trim() && !stopped) {
        addMessage({
          id: generateId(),
          role: 'error',
          text: 'I couldn’t generate a response for that request. Please try again.',
        });
      }

      if (limitReached) {
        addMessage({ id: generateId(), role: 'error', text: limitReached.message });
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      persistTurnOutput(tabId, tabSessions.getState(tabId).streamingText, onDeviceModelRef.current);
      showStreamingText('');
      // The on-device backend's cap only lands here when none of the model's
      // calls ran. That is no failure, and the chat goes on, as after any stop
      // at the limit.
      const atLimit = err instanceof ToolRoundLimitError;
      if (!atLimit) console.error('[WebMCP] Error during chat turn:', formatErrorMessage(err), err);
      addMessage({
        id: generateId(),
        role: 'error',
        text:
          err instanceof UserFacingError
            ? err.message
            : 'Something went wrong while processing your request. Please try again.',
      });
      if (internals.chatId && !atLimit) {
        endChat(internals.chatId, { onDevice: onDeviceModelRef.current });
        internals.chatId = undefined;
      }
    } finally {
      if (!signal.aborted) {
        tabSessions.update(tabId, { pendingPermission: null, pendingCheckpoint: null, busy: false });
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
    pendingCheckpoint: session.pendingCheckpoint,
    handleSendPrompt,
    handleStop,
    handleReset,
  };
}
