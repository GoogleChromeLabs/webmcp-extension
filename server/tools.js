/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsonSchema, tool } from 'ai';

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
export function buildTools(toolList = []) {
  if (!Array.isArray(toolList)) return {};
  const tools = {};
  for (const declared of toolList) {
    if (!declared?.name) continue;
    let parameters = declared.parameters ?? declared.inputSchema;
    if (typeof parameters === 'string') {
      try {
        parameters = JSON.parse(parameters);
      } catch {
        parameters = null;
      }
    }
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      parameters = { type: 'object', properties: {} };
    } else {
      parameters = {
        type: 'object',
        properties: {},
        ...parameters,
      };
    }
    tools[declared.name] = tool({
      description: declared.description || '',
      inputSchema: jsonSchema(parameters),
    });
  }
  return tools;
}

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
    : { type: 'json', value: result };
}

/**
 * Appends either a user prompt or tool execution results to a conversation's
 * `ModelMessage[]` history, settling any unanswered tool calls first so
 * upstream providers never reject dangling tool calls.
 */
export function appendTurnMessages(history = [], { message, toolResponses } = {}) {
  const last = history.at(-1);
  const callParts =
    last?.role === 'assistant' && Array.isArray(last.content)
      ? last.content.filter((part) => part.type === 'tool-call')
      : [];

  const toCallResult = (callPart, response) => ({
    type: 'tool-result',
    toolCallId: callPart.toolCallId,
    toolName: callPart.toolName,
    output: toToolResultOutput(response),
    ...(callPart.providerOptions ? { providerOptions: callPart.providerOptions } : {}),
  });

  if (Array.isArray(toolResponses) && toolResponses.length > 0) {
    const used = new Set();
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

    const content =
      callParts.length > 0
        ? callParts.map((callPart) => toCallResult(callPart, takeResponse(callPart)?.response))
        : toolResponses
            .filter((r) => r?.functionResponse)
            .map(({ functionResponse }) => ({
              type: 'tool-result',
              toolCallId: functionResponse.id || functionResponse.name,
              toolName: functionResponse.name,
              output: toToolResultOutput(functionResponse.response),
            }));

    return [...history, { role: 'tool', content }];
  }

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

