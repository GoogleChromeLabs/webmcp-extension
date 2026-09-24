/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'node:test';

export interface SequentialStepsOptions {
  /** Runs after every step that passed, e.g. to check no queued server reply was left unused. */
  afterEachStep?: () => void | Promise<void>;
}

export type StepFn = (name: string, fn: () => Promise<void>) => void;

/**
 * Returns an `it`-like function for steps that run in order and share one
 * browser session, chat and page.
 *
 * Such steps depend on each other: a failed step can leave a permission card
 * open or a queued reply unused, so later steps would fail for reasons that
 * have nothing to do with what they test. Once a step fails, every later step
 * is skipped with a message naming the step that broke, instead.
 */
export function createSequentialSteps(options: SequentialStepsOptions = {}): StepFn {
  let failedStep: string | null = null;
  return (name, fn) => {
    it(name, async (t) => {
      if (failedStep !== null) {
        t.skip(`earlier step "${failedStep}" failed, and the steps share one browser session`);
        return;
      }
      try {
        await fn();
        await options.afterEachStep?.();
      } catch (err) {
        failedStep = name;
        throw err;
      }
    });
  };
}
