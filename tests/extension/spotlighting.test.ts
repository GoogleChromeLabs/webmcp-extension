/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolUntrusted, buildToolDecls } from '../../extension/sidepanel/services/toolEncoder.js';
import { applySpotlighting } from '../../extension/sidepanel/services/toolResults.js';
import { type WebMCPTool } from '../../extension/sidepanel/types/index.js';

test('isToolUntrusted defaults to false per the WebMCP spec and respects untrustedContentHint', () => {
  const untrustedTool: WebMCPTool = {
    name: 'getPageContent',
    untrustedContentHint: true,
    frameId: 0,
  };
  const trustedTool: WebMCPTool = {
    name: 'internalMath',
    untrustedContentHint: false,
    frameId: 0,
  };
  const defaultTool: WebMCPTool = {
    name: 'unspecifiedTool',
    frameId: 0,
  };

  assert.equal(isToolUntrusted(untrustedTool), true);
  assert.equal(isToolUntrusted(trustedTool), false);
  assert.equal(isToolUntrusted(defaultTool), false);
  assert.equal(isToolUntrusted(undefined), false);
});

test('applySpotlighting returns raw data when untrustedContentHint is missing', () => {
  const defaultTool: WebMCPTool = { name: 'unspecifiedTool', frameId: 0 };
  const rawData = { result: 42 };
  assert.deepEqual(applySpotlighting(rawData, defaultTool), rawData);
  assert.deepEqual(applySpotlighting(rawData, undefined), rawData);
});

test('applySpotlighting returns raw base64 encoded string for untrusted content', () => {
  const untrustedTool: WebMCPTool = {
    name: 'readComments',
    untrustedContentHint: true,
    frameId: 0,
  };
  const rawData = 'Hello world! <script>alert("test")</script>';
  const spotlighted = applySpotlighting(rawData, untrustedTool) as string;

  assert.equal(typeof spotlighted, 'string');
  const decoded = Buffer.from(spotlighted, 'base64').toString('utf-8');
  assert.equal(decoded, rawData);
});

test('applySpotlighting returns raw data when tool is trusted', () => {
  const trustedTool: WebMCPTool = {
    name: 'trustedCalculator',
    untrustedContentHint: false,
    frameId: 0,
  };
  const rawData = { result: 42 };
  const res = applySpotlighting(rawData, trustedTool);
  assert.deepEqual(res, rawData);
});

test('buildToolDecls preserves clean tool descriptions without appending security annotations', () => {
  const tools: WebMCPTool[] = [
    {
      name: 'searchQuery',
      description: 'Searches webpage items',
      untrustedContentHint: true,
      frameId: 0,
    },
    {
      name: 'localClock',
      description: 'Gets device time',
      untrustedContentHint: false,
      frameId: 1,
    },
  ];

  const decls = buildToolDecls(tools);
  assert.equal(decls.length, 2);
  assert.equal(decls[0].description, 'Searches webpage items');
  assert.equal(decls[1].description, 'Gets device time');
});
