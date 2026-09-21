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
  window?: Window;
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
  message?: string;
  toolResponses?: Array<{
    functionResponse: { name: string; response: Record<string, unknown> };
  }>;
  tools?: ToolDeclaration[];
  chatId?: string;
}

export interface ChatTurnResponse {
  chatId?: string;
  text?: string;
  functionCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
}

export interface DecodedToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id?: string;
  name: string;
  result?: unknown;
  error?: string;
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
  meta?: string;
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
  args?: unknown;
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

export interface ExtensionListToolsMessage {
  action: 'LIST_TOOLS';
  fromOrigins?: string[];
  message?: string;
  tools?: WebMCPTool[];
  url?: string;
}

export interface ExtensionExecuteToolMessage {
  action: 'EXECUTE_TOOL';
  name: string;
  inputArgs?: Record<string, unknown> | string;
  frameId?: number;
}

export interface ExtensionGetCrossDocResultMessage {
  action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT';
  frameId?: number;
}

export type ExtensionMessage =
  | ExtensionListToolsMessage
  | ExtensionExecuteToolMessage
  | ExtensionGetCrossDocResultMessage;


