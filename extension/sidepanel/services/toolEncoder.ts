/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type WebMCPTool, type ToolDeclaration } from '../types/index.js';

/**
 * Builds function declarations for LLM API schemas from WebMCP tool objects.
 * Encodes tool frameID to ensure cross-frame dispatch accuracy.
 *
 * Security Note:
 * This is where you might utilize a prompt injection classifier to detect any prompt
 * injection in the tool descriptions or manifests before the model reads them.
 */

/**
 * What the frame a tool belongs to is written as in the name the model sees:
 * `f0_search_hotels` for the top-level document.
 *
 * The letter is what keeps the name from starting with `_0_`, which crashes
 * Chrome's on-device model the moment the declaration reaches it, before any
 * call is made. A leading `_` on its own is fine, and so is a digit anywhere.
 */
const FRAME_PREFIX = 'f';

/**
 * Writes a tool's name in the alphabet the on-device model can take.
 *
 * An uppercase letter anywhere in a declared tool's name crashes Chrome's
 * on-device model as the session is created: `f0_get_weather` answers, while
 * `f0_getWeather` ends the turn with `kErrorUnknown` and leaves the model
 * failing every later session with tools until the browser is restarted. So a
 * page that names its tools `openDoor1` or `searchHotels`, which is the usual
 * way to name them, could not be used at all.
 *
 * Every uppercase letter becomes `_` plus its lowercase form, and an existing
 * `_` doubles, which keeps the fold reversible: `openDoor1` goes to
 * `open_door1` and a tool actually named `open_door1` to `open__door1`. The
 * result stays readable, which matters because the model picks a tool by its
 * name. Both backends get the folded name, so one rule encodes and decodes.
 */
function foldToolName(name: string): string {
  return name.replace(/[_A-Z]/g, (character) =>
    character === '_' ? '__' : `_${character.toLowerCase()}`
  );
}

/** Turns a folded name back into the name the page declared. */
function unfoldToolName(name: string): string {
  return name.replace(/_(.)/gs, (_match, character: string) =>
    character === '_' ? '_' : character.toUpperCase()
  );
}

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
      name: `${FRAME_PREFIX}${frameId}_${foldToolName(tool.name)}`,
      description: tool.description || '',
      parameters: parsedParameters,
    };
  });
}

/**
 * Checks whether a tool's output is marked as untrusted web content.
 *
 * Follows the WebMCP spec, where the untrusted content hint is initially
 * false: only a tool that sets `untrustedContentHint: true` is spotlighted.
 */
export function isToolUntrusted(tool?: WebMCPTool): boolean {
  return tool?.untrustedContentHint === true;
}

/**
 * Decodes an encoded tool name (e.g. "f0_search_hotels") back into the tool
 * name the page declared ("searchHotels") and the frame it belongs to.
 */
export function decodeToolName(
  encodedName: string = ''
): { name: string; frameId?: number } {
  if (!encodedName) return { name: '', frameId: undefined };

  const match = encodedName.match(new RegExp(`^${FRAME_PREFIX}(\\d+)_(.*)$`, 's'));
  if (match) {
    return {
      frameId: parseInt(match[1], 10),
      name: unfoldToolName(match[2]),
    };
  }

  return {
    name: encodedName,
    frameId: undefined,
  };
}
