/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebMCPTool, ToolDeclaration } from '../types/index.js';

/**
 * Builds function declarations for LLM API schemas from WebMCP tool objects.
 * Encodes tool frameID to ensure cross-frame dispatch accuracy.
 */
export function buildToolDecls(toolsList: WebMCPTool[] = []): ToolDeclaration[] {
  return toolsList.map((tool) => {
    let parsedParameters: Record<string, unknown> = { type: 'object', properties: {} };

    if (tool.inputSchema) {
      if (typeof tool.inputSchema === 'string') {
        try {
          parsedParameters = JSON.parse(tool.inputSchema);
        } catch {
          parsedParameters = { type: 'object', properties: {} };
        }
      } else if (typeof tool.inputSchema === 'object') {
        parsedParameters = tool.inputSchema as Record<string, unknown>;
      }
    }

    const frameId = tool.frameId ?? 0;
    return {
      name: `_${frameId}_${tool.name}`,
      description: tool.description || '',
      parameters: parsedParameters,
    };
  });
}

/**
 * Decodes encoded tool name string (e.g., "_0_searchHotels") back into tool name and frame ID.
 */
export function decodeToolName(
  encodedName: string = ''
): { name: string; frameId?: number } {
  if (!encodedName) return { name: '', frameId: undefined };

  const match = encodedName.match(/^_(\d+)_(.*)$/s);
  if (match) {
    return {
      frameId: parseInt(match[1], 10),
      name: match[2],
    };
  }

  return {
    name: encodedName,
    frameId: undefined,
  };
}
