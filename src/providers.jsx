import React, { createContext, useContext, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export const PROVIDERS = {
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

/**
 * Creates a stateful chat session for the given provider.
 */
export function createChat({ provider, apiKey, model, systemInstruction, toolDecls, trace }) {
  const options = { apiKey, model, systemInstruction, toolDecls, trace };
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

/** One-shot completion for prompt suggestions. */
export async function oneShot({ provider, apiKey, model, contents }) {
  const text = contents.join('\n');
  switch (provider) {
    case 'gemini': {
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({ model, contents });
      return response.text;
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
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
}

class GeminiChat {
  constructor({ apiKey, model, systemInstruction, toolDecls, trace }) {
    this.client = new GoogleGenAI({ apiKey });
    this.chat = this.client.chats.create({ model });
    this.systemInstruction = systemInstruction;
    this.trace = trace;
    this.setTools(toolDecls);
  }

  setTools(toolDecls) {
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

  async #send(message) {
    const params = { message, config: this.config };
    this.trace.push({ request: params });
    const response = await this.chat.sendMessage(params);
    this.trace.push({ response });
    const toolCalls = (response.functionCalls || []).map((call, i) => ({
      id: call.id ?? `call_${i}`,
      name: call.name,
      args: call.args,
    }));
    let text = '';
    try {
      text = response.text || '';
    } catch {
      text = '';
    }
    return { text, toolCalls };
  }

  send(text) {
    return this.#send(text);
  }

  sendToolResults(results) {
    return this.#send(
      results.map(({ name, result, error }) => {
        let resVal;
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
      }),
    );
  }
}

function formatResultContent(result) {
  if (result == null) return '';
  if (typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result);
}

class OpenAIChat {
  constructor({ apiKey, model, systemInstruction, toolDecls, trace }) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
    this.trace = trace;
    this.messages = [{ role: 'system', content: Array.isArray(systemInstruction) ? systemInstruction.join('\n') : systemInstruction }];
    this.setTools(toolDecls);
  }

  setTools(toolDecls) {
    this.tools = toolDecls.map((decl) => ({
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters,
      },
    }));
  }

  async #request() {
    const params = {
      model: this.model,
      messages: this.messages,
      tools: this.tools.length ? this.tools : undefined,
    };
    this.trace.push({ request: params });
    const completion = await this.client.chat.completions.create(params);
    this.trace.push({ response: completion });
    const message = completion.choices[0].message;
    this.messages.push(message);
    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: call.id,
      name: call.function.name,
      args: JSON.parse(call.function.arguments || '{}'),
    }));
    return { text: message.content, toolCalls };
  }

  send(text) {
    this.messages.push({ role: 'user', content: text });
    return this.#request();
  }

  sendToolResults(results) {
    for (const { id, result, error } of results) {
      this.messages.push({
        role: 'tool',
        tool_call_id: id,
        content: error ? `Error: ${error}` : formatResultContent(result),
      });
    }
    return this.#request();
  }
}

class AnthropicChat {
  constructor({ apiKey, model, systemInstruction, toolDecls, trace }) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
    this.system = Array.isArray(systemInstruction) ? systemInstruction.join('\n') : systemInstruction;
    this.trace = trace;
    this.messages = [];
    this.setTools(toolDecls);
  }

  setTools(toolDecls) {
    this.tools = toolDecls.map((decl) => ({
      name: decl.name,
      description: decl.description,
      input_schema: decl.parameters,
    }));
  }

  async #request() {
    const params = {
      model: this.model,
      max_tokens: 16000,
      system: this.system,
      messages: this.messages,
      tools: this.tools.length ? this.tools : undefined,
    };
    if (!this.model.startsWith('claude-haiku')) {
      params.thinking = { type: 'adaptive' };
    }
    this.trace.push({ request: params });
    const response = await this.client.messages.create(params);
    this.trace.push({ response });
    this.messages.push({ role: 'assistant', content: response.content });
    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, args: block.input }));
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (response.stop_reason === 'refusal') {
      return { text: text || '⚠️ The model declined to answer this request.', toolCalls: [] };
    }
    return { text, toolCalls };
  }

  send(text) {
    this.messages.push({ role: 'user', content: text });
    return this.#request();
  }

  sendToolResults(results) {
    this.messages.push({
      role: 'user',
      content: results.map(({ id, result, error }) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: error ? `Error: ${error}` : formatResultContent(result),
        is_error: !!error,
      })),
    });
    return this.#request();
  }
}

/**
 * AIProviderContext & Hook
 */
const AIProviderContext = createContext(null);

export function AIProvider({ children }) {
  const [provider, setProvider] = useState(() => localStorage.provider || 'gemini');
  const [model, setModel] = useState(() => {
    const p = localStorage.provider || 'gemini';
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
