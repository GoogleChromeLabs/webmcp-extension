/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Page } from 'puppeteer-core';

/**
 * Evaluates a JavaScript expression in `page` and returns its value.
 * Promises are awaited, and the value is serialized back to Node.
 *
 * Expressions are passed as strings, not functions, because the test bundle is
 * compiled by esbuild: helper names it injects into a function would not exist
 * inside the page.
 */
export async function evaluate<T>(page: Page, expression: string): Promise<T> {
  return (await page.evaluate(expression)) as T;
}

/**
 * Polls `check` until it returns something other than null, undefined or
 * false, and returns that value. Errors thrown by `check` are retried and the
 * last one is reported on timeout.
 */
export async function waitForCondition<T>(
  check: () => Promise<T | null | undefined | false>,
  description: string,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<T> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const suffix = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}
