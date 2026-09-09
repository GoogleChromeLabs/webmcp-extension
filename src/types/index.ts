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
  frameId?: number;
  window?: Window;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  time: string;
  source: 'assistant' | 'user';
  name: string;
  args: unknown;
  start: number;
  status: 'running' | 'ok' | 'err';
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai' | 'error';
  text: string;
  meta?: string;
  activityLogs?: ActivityEntry[];
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


