/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebMCPTool, ToolDeclaration } from '../types';

/**
 * Builds function declarations for LLM API schemas from WebMCP tool objects.
 * Encodes tool location index to ensure cross-frame dispatch accuracy.
 */
export function buildToolDecls(toolsList: WebMCPTool[] = []): ToolDeclaration[] {
  return toolsList.map((tool) => {
    const locationIndex = toolsList.findIndex((t) => t.location === tool.location);
    const encodedLocation = locationIndex >= 0 ? locationIndex : 0;
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

    return {
      name: `_${encodedLocation}_${tool.name}`,
      description: tool.description || '',
      parameters: parsedParameters,
    };
  });
}

/**
 * Decodes encoded tool name string (e.g., "_0_searchHotels") back into tool name and location URL.
 */
export function decodeToolName(
  toolsList: WebMCPTool[] = [],
  encodedName: string = ''
): { name: string; location?: string } {
  if (!encodedName) return { name: '', location: undefined };

  const match = encodedName.match(/^_(\d+)_(.*)$/);
  if (match) {
    const locationIndex = Number(match[1]);
    const targetTool = toolsList[locationIndex] ?? toolsList.find((t) => t.name === match[2]);
    return {
      name: match[2],
      location: targetTool?.location,
    };
  }

  const unencodedTool = toolsList.find((t) => t.name === encodedName);
  return { name: encodedName, location: unencodedTool?.location };
}
