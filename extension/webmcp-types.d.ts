/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Augments the global `WebMCP` namespace from the `webmcp-types` package with
// members the spec has added but the package does not declare yet.
//
// TODO: Remove once `webmcp-types` ships `outputSchema`.
// See https://github.com/webmachinelearning/webmcp-types/pull/16
declare namespace WebMCP {
  interface RegisteredTool {
    /**
     * A JSON Schema object describing the expected output structure for the tool.
     * It is a deep copy of the schema provided at tool registration, via `ModelContextTool.outputSchema`.
     */
    outputSchema?: object;
  }
}
