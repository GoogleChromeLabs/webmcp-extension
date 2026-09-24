/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsonSchema, tool } from 'ai';

/** @typedef {import('ai').ModelMessage} ModelMessage */
/** @typedef {import('ai').ToolCallPart} ToolCallPart */
/** @typedef {import('ai').ToolResultPart} ToolResultPart */

/**
 * A page tool as the side panel declares it (`ToolDeclaration` in
 * src/sidepanel/types/index.ts). It comes from the request body, so nothing
 * about it is trusted.
 *
 * @typedef {{ name?: unknown, description?: string, parameters?: unknown }} ToolDeclaration
 */

/**
 * One tool's outcome as the side panel reports it.
 *
 * @typedef {{ result?: unknown, error?: unknown }} ToolOutcome
 * @typedef {{ functionResponse?: { id?: string, name?: string, response?: ToolOutcome } }} ToolResponse
 */

/**
 * Declares the page's tools for the model.
 *
 * Schemas arrive as raw JSON Schema from whatever page the user is on, so they
 * cannot be Zod: `jsonSchema()` takes them as they are. They are passed through
 * untouched, including keywords like `oneOf` and `anyOf` that some providers
 * have historically refused. Stripping those was tried and reverted: Gemini
 * accepts all of them today, and removing one turns a described field into an
 * undescribed one, which is worse than the error it was meant to avoid. If a
 * provider does start rejecting a schema, the fix belongs here, aimed at
 * whatever it actually objected to.
 *
 * No tool is given an `execute`. Tools belong to the web page, not to this
 * server: a tool without one ends the step, so the call goes back to the side
 * panel to be permitted and run there. That is the SDK's default behaviour and
 * nothing here has to enforce it.
 */
/**
 * @param {ToolDeclaration[]} [toolList]
 * @returns {import('ai').ToolSet}
 */
export function buildTools(toolList = []) {
  if (!Array.isArray(toolList)) return {};
  /** @type {import('ai').ToolSet} */
  const tools = {};
  for (const declared of toolList) {
    if (!declared?.name || typeof declared.name !== 'string') continue;
    // The side panel already sends an object schema (see buildToolDecls in
    // src/sidepanel/services/toolEncoder.ts). This only guards the shape, since the
    // request body could come from anything holding the auth token.
    const { parameters } = declared;
    const isObject = parameters && typeof parameters === 'object' && !Array.isArray(parameters);
    tools[declared.name] = tool({
      description: declared.description || '',
      inputSchema: jsonSchema({ type: 'object', properties: {}, ...(isObject ? /** @type {object} */ (parameters) : {}) }),
    });
  }
  return tools;
}

/**
 * @param {ToolOutcome | null | undefined} response
 * @returns {ToolResultPart['output']}
 */
function toToolResultOutput(response) {
  if (!response) {
    return { type: 'error-text', value: 'No response was produced for this call.' };
  }
  if (response.error !== undefined) {
    return { type: 'error-text', value: String(response.error) };
  }
  const result = response.result ?? '';
  return typeof result === 'string'
    ? { type: 'text', value: result }
    : { type: 'json', value: /** @type {import('ai').JSONValue} */ (result) };
}

/**
 * The tool calls the last assistant message is still waiting on.
 *
 * @param {ModelMessage[]} history
 * @returns {ToolCallPart[]}
 */
function pendingToolCalls(history) {
  const last = history.at(-1);
  return last?.role === 'assistant' && Array.isArray(last.content)
    ? last.content.filter((part) => part.type === 'tool-call')
    : [];
}

/**
 * Whether the conversation is waiting on tool results. When it is not, tool
 * results have nothing to answer: the server was restarted, or the chat was
 * evicted, and providers reject a tool result without its call.
 */
/**
 * @param {ModelMessage[]} [history]
 * @returns {boolean}
 */
export function hasPendingToolCalls(history = []) {
  return pendingToolCalls(history).length > 0;
}

/**
 * Appends either a user prompt or tool execution results to a conversation's
 * `ModelMessage[]` history, settling any unanswered tool calls first so
 * upstream providers never reject dangling tool calls.
 *
 * Tool results are only appended when `hasPendingToolCalls(history)`; the
 * caller checks that first.
 */
/**
 * @param {ModelMessage[]} [history]
 * @param {{ message?: unknown, toolResponses?: ToolResponse[] }} [turn]
 * @returns {ModelMessage[]}
 */
export function appendTurnMessages(history = [], { message, toolResponses } = {}) {
  const callParts = pendingToolCalls(history);

  /**
   * @param {ToolCallPart} callPart
   * @param {ToolOutcome | null | undefined} response
   * @returns {ToolResultPart}
   */
  const toCallResult = (callPart, response) => ({
    type: 'tool-result',
    toolCallId: callPart.toolCallId,
    toolName: callPart.toolName,
    output: toToolResultOutput(response),
    ...(callPart.providerOptions ? { providerOptions: callPart.providerOptions } : {}),
  });

  if (Array.isArray(toolResponses) && toolResponses.length > 0) {
    /** @type {Set<number>} */
    const used = new Set();
    /** @param {ToolCallPart} callPart */
    const takeResponse = (callPart) => {
      let idx = toolResponses.findIndex(
        (r, i) => !used.has(i) && r?.functionResponse?.id && r.functionResponse.id === callPart.toolCallId
      );
      if (idx === -1) {
        idx = toolResponses.findIndex(
          (r, i) =>
            !used.has(i) &&
            (!r?.functionResponse?.id || !callPart.toolCallId) &&
            r?.functionResponse?.name === callPart.toolName
        );
      }
      if (idx === -1) return undefined;
      used.add(idx);
      return toolResponses[idx].functionResponse;
    };

    const content = callParts.map((callPart) => toCallResult(callPart, takeResponse(callPart)?.response));
    return [...history, { role: 'tool', content }];
  }

  /** @type {ModelMessage[]} */
  const settled =
    callParts.length > 0
      ? [
          ...history,
          {
            role: 'tool',
            content: callParts.map((callPart) => toCallResult(callPart, null)),
          },
        ]
      : history;

  if (message !== undefined) {
    return [...settled, { role: 'user', content: [{ type: 'text', text: String(message) }] }];
  }

  return settled;
}
