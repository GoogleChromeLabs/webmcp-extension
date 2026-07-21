/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProviderKey = 'gemini' | 'openai' | 'anthropic';

export interface ProviderConfig {
  label: string;
  models: string[];
  keyUrl: string;
}

export type ProvidersMap = Record<ProviderKey, ProviderConfig>;

export interface WebMCPTool {
  name: string;
  description?: string;
  inputSchema?: string | Record<string, unknown> | null;
  readOnlyHint?: string;
  untrustedContentHint?: string;
  location?: string;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
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
  inputArgs?: string;
  location?: string;
}

export interface ExtensionGetCrossDocResultMessage {
  action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT';
  location?: string;
}

export type ExtensionMessage =
  | ExtensionListToolsMessage
  | ExtensionExecuteToolMessage
  | ExtensionGetCrossDocResultMessage;

export interface ChatSessionOptions {
  provider: ProviderKey;
  apiKey: string;
  model: string;
  systemInstruction?: string | string[];
  toolDecls: ToolDeclaration[];
  trace: unknown[];
}

export interface IChatSession {
  setTools(toolDecls: ToolDeclaration[]): void;
  send(text: string): Promise<{ text: string; toolCalls?: DecodedToolCall[] }>;
  sendToolResults(results: ToolResult[]): Promise<{ text: string; toolCalls?: DecodedToolCall[] }>;
}
