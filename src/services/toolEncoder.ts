/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebMCPTool, ToolDeclaration } from '../types/index.js';

/**
 * Builds function declarations for LLM API schemas from WebMCP tool objects.
 * Encodes tool frameID to ensure cross-frame dispatch accuracy.
 *
 * Security Note:
 * This is where you might utilize a prompt injection classifier to detect any prompt
 * injection in the tool descriptions or manifests before the model reads them.
 */
export function buildToolDecls(toolsList: WebMCPTool[] = []): ToolDeclaration[] {
  return toolsList.map((tool) => {
    let rawSchema: unknown = tool.inputSchema;
    if (typeof rawSchema === 'string') {
      try {
        rawSchema = JSON.parse(rawSchema);
      } catch {
        rawSchema = null;
      }
    }
    const parsedParameters: Record<string, unknown> =
      rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
        ? { type: 'object', properties: {}, ...(rawSchema as Record<string, unknown>) }
        : { type: 'object', properties: {} };

    const frameId = tool.frameId ?? 0;
    return {
      name: `_${frameId}_${tool.name}`,
      description: tool.description || '',
      parameters: parsedParameters,
    };
  });
}

/**
 * Checks whether a tool's output is marked as untrusted web content.
 */
export function isToolUntrusted(tool?: WebMCPTool): boolean {
  if (!tool) return true; // Default to untrusted for web content
  return tool.untrustedContentHint !== false;
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
