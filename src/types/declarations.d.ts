/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.woff2' {
  const content: string;
  export default content;
}

declare module '*.env.json' {
  const content: {
    apiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    model?: string;
    provider?: string;
  };
  export default content;
}

declare module '../../extension/utils.js' {
  export function getIframeOrigins(tabId: number): Promise<string[]>;
}

declare module '../extension/utils.js' {
  export function getIframeOrigins(tabId: number): Promise<string[]>;
}
