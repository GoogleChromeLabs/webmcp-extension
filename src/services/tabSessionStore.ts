/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { endChat } from './chatBridge.js';
import { clearSessionToolPermissions } from './toolPermissions.js';
import {
  ActivityEntry,
  ChatMessage,
  PendingToolPermission,
  WebMCPTool,
} from '../types/index.js';

/**
 * Everything the side panel shows for one tab.
 *
 * The panel is a single window shared by every tab, so without a key like this
 * one tab's conversation — and, worse, its permission prompt — would still be
 * on screen after switching to a page that never asked for anything. Each tab
 * keeps its own, and the panel renders whichever tab is in front.
 */
interface TabSessionState {
  /** What is typed in the composer but not sent yet. */
  userPrompt: string;
  messages: ChatMessage[];
  busy: boolean;
  activityLog: ActivityEntry[];
  /** The reply being written right now, until it becomes one of `messages`. */
  streamingText: string;
  pendingPermission: PendingToolPermission | null;
  /** The tools the page in this tab exposes, as last reported. */
  tools: WebMCPTool[];
  domain: string;
  origin: string;
  favicon: string;
  statusMsg: string;
}

/**
 * The state of a tab nothing has happened in yet. Shared rather than rebuilt
 * per read: `useSyncExternalStore` compares snapshots by identity and would
 * loop forever on a fresh object every time.
 */
const EMPTY_TAB_SESSION: TabSessionState = Object.freeze({
  userPrompt: '',
  messages: Object.freeze([]) as unknown as ChatMessage[],
  busy: false,
  activityLog: Object.freeze([]) as unknown as ActivityEntry[],
  streamingText: '',
  pendingPermission: null,
  tools: Object.freeze([]) as unknown as WebMCPTool[],
  domain: '',
  origin: '',
  favicon: '',
  statusMsg: '',
});

/**
 * The parts of a tab's session that drive a turn but are never rendered. They
 * are mutated in place, the way the refs they replace were: a turn reads them
 * long after the render that started it.
 */
interface TabSessionInternals {
  /** Identifies the conversation to whichever backend is holding it. */
  chatId?: string;
  abortController: AbortController | null;
  /** The activity of the turn in flight, for the message it ends up on. */
  turnLogs: ActivityEntry[];
}

type TabSessionPatch =
  | Partial<TabSessionState>
  | ((previous: TabSessionState) => Partial<TabSessionState>);

function isUnchanged(previous: TabSessionState, next: TabSessionState): boolean {
  return (Object.keys(next) as Array<keyof TabSessionState>).every((key) => previous[key] === next[key]);
}

/**
 * The side panel's per-tab state, outside React so that a turn running in a
 * background tab keeps writing to its own tab while the user works in another.
 */
class TabSessionStore {
  private states = new Map<number, TabSessionState>();
  private internals = new Map<number, TabSessionInternals>();
  private listeners = new Set<() => void>();

  /** Bound so React sees the same function across renders. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The state to render for `tabId`, or the empty one for an unknown tab. */
  getState = (tabId: number | null | undefined): TabSessionState => {
    if (tabId == null) return EMPTY_TAB_SESSION;
    return this.states.get(tabId) ?? EMPTY_TAB_SESSION;
  };

  /** Whether `tabId` holds an active turn or existing conversation worth following in the background. */
  hasConversation(tabId: number): boolean {
    const state = this.states.get(tabId);
    const internals = this.internals.get(tabId);
    return Boolean(state?.busy || state?.messages.length || internals?.chatId);
  }

  /**
   * Applies `patch` to a tab's state and tells React, unless nothing changed:
   * reports of an unchanged tool list arrive on a timer, and re-rendering the
   * panel for each of them would be waste.
   */
  update(tabId: number, patch: TabSessionPatch): void {
    const previous = this.getState(tabId);
    const changes = typeof patch === 'function' ? patch(previous) : patch;
    const next: TabSessionState = { ...previous, ...changes };
    if (this.states.has(tabId) && isUnchanged(previous, next)) return;
    this.states.set(tabId, next);
    this.emit();
  }

  /** The turn state of `tabId`, created on first use. */
  getInternals(tabId: number): TabSessionInternals {
    let internals = this.internals.get(tabId);
    if (!internals) {
      internals = { chatId: undefined, abortController: null, turnLogs: [] };
      this.internals.set(tabId, internals);
    }
    return internals;
  }

  /** Every tab the panel is holding something for. */
  tabIds(): number[] {
    return [...new Set([...this.states.keys(), ...this.internals.keys()])];
  }

  /** The tabs with a turn in flight, which need the shared model in turn. */
  busyTabIds(): number[] {
    return [...this.states.entries()].filter(([, state]) => state.busy).map(([tabId]) => tabId);
  }

  /** Bound for `useSyncExternalStore`, which needs one stable function. */
  isAnyBusy = (): boolean => {
    for (const state of this.states.values()) {
      if (state.busy) return true;
    }
    return false;
  };

  /**
   * Resets a tab's conversation state and releases its backend session while
   * keeping the tab's discovered tools and page metadata intact.
   */
  resetChat(tabId: number, options: { onDevice?: boolean } = {}): void {
    const internals = this.internals.get(tabId);
    if (internals) {
      internals.abortController?.abort();
      internals.abortController = null;
      if (internals.chatId) {
        endChat(internals.chatId, options);
        internals.chatId = undefined;
      }
      internals.turnLogs = [];
    }
    clearSessionToolPermissions(tabId);
    this.update(tabId, {
      userPrompt: '',
      messages: [],
      activityLog: [],
      streamingText: '',
      pendingPermission: null,
      busy: false,
    });
  }

  /**
   * Stops and forgets a tab's session, for a tab that has been closed. The
   * conversation is ended on the backend too, so a chat nothing can reach
   * again does not sit there holding context.
   */
  remove(tabId: number, options: { onDevice?: boolean } = {}): void {
    const internals = this.internals.get(tabId);
    if (internals) {
      internals.abortController?.abort();
      if (internals.chatId) endChat(internals.chatId, options);
    }
    clearSessionToolPermissions(tabId);
    const existed = this.states.delete(tabId);
    this.internals.delete(tabId);
    if (existed) this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const tabSessions = new TabSessionStore();
