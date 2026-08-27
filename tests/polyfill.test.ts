/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('webmcp-polyfill attaches document.modelContext and executes tools', async () => {
  const polyfillCode = fs.readFileSync(path.resolve('extension/webmcp-polyfill.js'), 'utf-8');

  // Minimal window/document sandbox
  class MockDOMException extends Error {
    name: string;
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
    }
  }

  const mockWindow: Record<string, unknown> = {
    origin: 'https://example.com',
    DOMException: MockDOMException,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    postMessage: () => {},
  };

  const mockDocument: Record<string, unknown> = {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    styleSheets: [],
    head: { appendChild: () => {} },
    addEventListener: () => {},
  };

  mockWindow.document = mockDocument;
  mockWindow.window = mockWindow;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    EventTarget,
    Event,
    CustomEvent: Event,
    DOMException: MockDOMException,
    Map,
    Set,
    Promise,
    JSON,
    Array,
    Object,
    setTimeout,
    clearTimeout,
    console,
  });

  // Execute polyfill in VM context
  vm.runInContext(polyfillCode, context);

  const modelContext = mockDocument.modelContext as {
    registerTool: (tool: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void>;
    getTools: (options?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    executeTool: (tool: Record<string, unknown>, args: unknown) => Promise<unknown>;
    ontoolchange: ((e: Event) => void) | null;
  };

  assert.ok(modelContext, 'document.modelContext should be defined');
  assert.equal(typeof modelContext.registerTool, 'function');
  assert.equal(typeof modelContext.getTools, 'function');
  assert.equal(typeof modelContext.executeTool, 'function');

  // Verify ontoolchange handler
  let toolChangeFired = false;
  modelContext.ontoolchange = () => {
    toolChangeFired = true;
  };

  // Register a tool
  await modelContext.registerTool({
    name: 'calculateSum',
    description: 'Calculates the sum of two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
    execute: (args: { a: number; b: number }) => {
      return args.a + args.b;
    },
  });

  assert.ok(toolChangeFired, 'ontoolchange should fire when a tool is registered');

  // Discover registered tools
  const tools = await modelContext.getTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'calculateSum');
  assert.equal(tools[0].description, 'Calculates the sum of two numbers');

  // Execute tool
  const result = await modelContext.executeTool(tools[0], { a: 15, b: 27 });
  assert.equal(result, 42);

  // Verify idempotency: running polyfill again should not overwrite existing document.modelContext
  const initialContext = mockDocument.modelContext;
  vm.runInContext(polyfillCode, context);
  assert.equal(mockDocument.modelContext, initialContext);
});
