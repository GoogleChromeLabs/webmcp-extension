/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WebMCPTool {
  name: string;
  description?: string;
  inputSchema?: string | Record<string, unknown> | null;
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  /**
   * The page's declaration that running this tool has real-world consequences
   * that may not be reversible — paying, booking, sending, deleting. It is an
   * advisory hint from an untrusted source, so it is only ever used to ask for
   * *more* confirmation, never less.
   */
  consequentialHint?: boolean;
  frameId?: number;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * One turn of a chat, as both the local backend server and the on-device
 * Prompt API backend take it: either a user message or the tool responses for
 * the calls of the previous turn, always with the tools of the active page.
 */
export interface ChatTurnRequest {
  chatId?: string;
  message?: string;
  toolResponses?: Array<{
    functionResponse: {
      id?: string;
      name: string;
      response: { result?: unknown; error?: string };
    };
  }>;
  tools?: ToolDeclaration[];
}

export interface ChatTurnResponse {
  chatId?: string;
  text?: string;
  functionCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
}

export interface ActivityEntry {
  id: number;
  name: string;
  done: boolean;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai' | 'error';
  text: string;
  activityLogs?: ActivityEntry[];
  /** Written by the on-device model rather than the backend server. */
  onDevice?: boolean;
}

/**
 * A tool call waiting for the user to allow or deny it. It belongs to the tab
 * whose turn asked for it, so switching tabs puts it away rather than carrying
 * it over to a page that never asked for anything.
 */
export interface PendingToolPermission {
  toolName: string;
  toolDescription?: string;
  /** The origin the tool belongs to, absent for a page that has none. */
  origin?: string;
  /**
   * The page marked this tool as doing something that may not be reversible.
   * The prompt is mandatory and cannot be remembered.
   */
  consequential?: boolean;
  /** Run the tool this once. */
  allow: () => void;
  /**
   * Run the tool now and every other time this origin calls it, until the chat
   * is reset or the panel is closed. Absent when the grant would not mean what
   * the button says — including for anything consequential.
   */
  allowAlways?: () => void;
  deny: () => void;
}

/**
 * An error whose `message` is safe and written to be shown directly to the user
 * in the chat UI, unlike raw backend or browser exceptions.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}
