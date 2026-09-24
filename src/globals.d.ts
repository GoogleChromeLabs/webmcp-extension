/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for the parts of the experimental WebMCP API (`document.modelContext`)
 * and of the extension's own scripts that TypeScript does not know about.
 */

interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

/** A tool as `document.modelContext.getTools()` reports it. */
interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: ModelContextToolAnnotations;
  /** The window of the frame that registered the tool. */
  window: Window;
}

interface ModelContext extends EventTarget {
  getTools(options?: { fromOrigins?: string[] }): Promise<ModelContextTool[]>;
  executeTool(tool: ModelContextTool, input: unknown): Promise<unknown>;
  ontoolchange: (() => void) | null;
}

interface Document {
  /** Present when the "WebMCP for testing" flag is on. */
  readonly modelContext?: ModelContext;
}

interface Window {
  /** Set once the service worker's frame-id listener is in this document. */
  webmcpFrameIdListenerInstalled?: boolean;
}
