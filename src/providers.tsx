/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
  ProvidersMap,
  ChatSessionOptions,
  IChatSession,
  ToolDeclaration,
  DecodedToolCall,
  ToolResult,
  ProviderKey,
} from './types/index.js';

export const PROVIDERS: ProvidersMap = {
  gemini: {
    label: 'Gemini',
    models: ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-5.1', 'gpt-5-mini', 'gpt-4.1'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
};

export function createChat({
  provider,
  apiKey,
  model,
  systemInstruction,
  toolDecls,
  trace,
}: ChatSessionOptions): IChatSession {
  const options = { provider, apiKey, model, systemInstruction, toolDecls, trace };
  switch (provider) {
    case 'gemini':
      return new GeminiChat(options);
    case 'openai':
      return new OpenAIChat(options);
    case 'anthropic':
      return new AnthropicChat(options);
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
}

export async function oneShot({
  provider,
  apiKey,
  model,
  contents,
}: {
  provider: ProviderKey;
  apiKey: string;
  model: string;
  contents: string[];
}): Promise<string> {
  const text = contents.join('\n');
  switch (provider) {
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({ model, contents });
      return response.text ?? '';
    }
    case 'openai': {
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: text }],
      });
      return completion.choices[0]?.message?.content ?? '';
    }
    case 'anthropic': {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: text }],
      });
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
}

class GeminiChat implements IChatSession {
  private client: GoogleGenAI;
  private chat: ReturnType<GoogleGenAI['chats']['create']>;
  private systemInstruction?: string | string[];
  private trace: unknown[];
  private config: Record<string, unknown> = {};

  constructor({ apiKey, model, systemInstruction, toolDecls, trace }: ChatSessionOptions) {
    this.client = new GoogleGenAI({ apiKey });
    this.chat = this.client.chats.create({ model });
    this.systemInstruction = systemInstruction;
    this.trace = trace;
    this.setTools(toolDecls);
  }

  setTools(toolDecls: ToolDeclaration[]) {
    const functionDeclarations = toolDecls.map((decl) => ({
      name: decl.name,
      description: decl.description,
      parametersJsonSchema: decl.parameters,
    }));
    this.config = {
      systemInstruction: this.systemInstruction,
      tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
    };
  }

  async #send(message: unknown): Promise<{ text: string; toolCalls?: DecodedToolCall[] }> {
    const params = { message, config: this.config };
    this.trace.push({ request: params });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await this.chat.sendMessage(params as any)) as any;
    this.trace.push({ response });
    const toolCalls: DecodedToolCall[] = (response.functionCalls || []).map(
      (call: { id?: string; name: string; args: Record<string, unknown> }, i: number) => ({
        id: call.id ?? `call_${i}`,
        name: call.name,
        args: call.args,
      })
    );
    let text = '';
    try {
      text = response.text || '';
    } catch {
      text = '';
    }
    return { text, toolCalls };
  }

  send(text: string) {
    return this.#send(text);
  }

  sendToolResults(results: ToolResult[]) {
    return this.#send(
      results.map(({ name, result, error }) => {
        let resVal: unknown;
        if (error) {
          resVal = { error };
        } else if (result === undefined || result === null || result === '') {
          resVal = { status: 'success', message: 'Tool executed successfully on page.' };
        } else {
          resVal = { result };
        }
        return {
          functionResponse: { name, response: resVal },
        };
      })
    );
  }
}

function formatResultContent(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result);
}

class OpenAIChat implements IChatSession {
  private client: OpenAI;
  private model: string;
  private trace: unknown[];
  private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  private tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  constructor({ apiKey, model, systemInstruction, toolDecls, trace }: ChatSessionOptions) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
    this.trace = trace;
    const sysContent = Array.isArray(systemInstruction) ? systemInstruction.join('\n') : systemInstruction || '';
    this.messages = [{ role: 'system', content: sysContent }];
    this.setTools(toolDecls);
  }

  setTools(toolDecls: ToolDeclaration[]) {
    this.tools = toolDecls.map((decl) => ({
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters,
      },
    }));
  }

  async #request(): Promise<{ text: string; toolCalls?: DecodedToolCall[] }> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: this.messages,
      tools: this.tools.length ? this.tools : undefined,
    };
    this.trace.push({ request: params });
    const completion = await this.client.chat.completions.create(params);
    this.trace.push({ response: completion });
    const message = completion.choices[0].message;
    this.messages.push(message);
    const toolCalls: DecodedToolCall[] = (message.tool_calls || [])
      .map((call) => {
        if ('function' in call && call.function) {
          return {
            id: call.id,
            name: call.function.name,
            args: JSON.parse(call.function.arguments || '{}'),
          };
        }
        return { id: call.id, name: '', args: {} };
      })
      .filter((c) => c.name !== '');

    return { text: message.content || '', toolCalls };
  }

  send(text: string) {
    this.messages.push({ role: 'user', content: text });
    return this.#request();
  }

  sendToolResults(results: ToolResult[]) {
    for (const { id, result, error } of results) {
      if (id) {
        this.messages.push({
          role: 'tool',
          tool_call_id: id,
          content: error ? `Error: ${error}` : formatResultContent(result),
        });
      }
    }
    return this.#request();
  }
}

class AnthropicChat implements IChatSession {
  private client: Anthropic;
  private model: string;
  private system: string;
  private trace: unknown[];
  private messages: Anthropic.MessageParam[];
  private tools: Anthropic.Tool[] = [];

  constructor({ apiKey, model, systemInstruction, toolDecls, trace }: ChatSessionOptions) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
    this.system = Array.isArray(systemInstruction) ? systemInstruction.join('\n') : systemInstruction || '';
    this.trace = trace;
    this.messages = [];
    this.setTools(toolDecls);
  }

  setTools(toolDecls: ToolDeclaration[]) {
    this.tools = toolDecls.map((decl) => ({
      name: decl.name,
      description: decl.description,
      input_schema: decl.parameters as Anthropic.Tool.InputSchema,
    }));
  }

  async #request(): Promise<{ text: string; toolCalls?: DecodedToolCall[] }> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 16000,
      system: this.system,
      messages: this.messages,
      tools: this.tools.length ? this.tools : undefined,
    };
    if (!this.model.startsWith('claude-haiku')) {
      (params as unknown as Record<string, unknown>).thinking = { type: 'adaptive' };
    }
    this.trace.push({ request: params });
    const response = await this.client.messages.create(params);
    this.trace.push({ response });
    this.messages.push({ role: 'assistant', content: response.content });

    const toolCalls: DecodedToolCall[] = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, args: block.input as Record<string, unknown> }));

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    if (response.stop_reason === 'refusal') {
      return { text: text || '⚠️ The model declined to answer this request.', toolCalls: [] };
    }
    return { text, toolCalls };
  }

  send(text: string) {
    this.messages.push({ role: 'user', content: text });
    return this.#request();
  }

  sendToolResults(results: ToolResult[]) {
    this.messages.push({
      role: 'user',
      content: results.map(({ id, result, error }) => ({
        type: 'tool_result',
        tool_use_id: id || '',
        content: error ? `Error: ${error}` : formatResultContent(result),
        is_error: !!error,
      })),
    });
    return this.#request();
  }
}

interface AIProviderContextType {
  provider: ProviderKey;
  setProvider: (p: ProviderKey) => void;
  model: string;
  setModel: (m: string) => void;
  PROVIDERS: ProvidersMap;
}

const AIProviderContext = createContext<AIProviderContextType | null>(null);

export function AIProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ProviderKey>(() =>
    PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini'
  );
  const [model, setModel] = useState<string>(() => {
    const p = PROVIDERS[localStorage.provider as ProviderKey] ? (localStorage.provider as ProviderKey) : 'gemini';
    const m = localStorage[`model_${p}`];
    return PROVIDERS[p]?.models.includes(m) ? m : PROVIDERS[p]?.models[0];
  });

  return (
    <AIProviderContext.Provider value={{ provider, setProvider, model, setModel, PROVIDERS }}>
      {children}
    </AIProviderContext.Provider>
  );
}

export function useAIProvider() {
  const context = useContext(AIProviderContext);
  if (!context) {
    return { PROVIDERS };
  }
  return context;
}

export default PROVIDERS;
