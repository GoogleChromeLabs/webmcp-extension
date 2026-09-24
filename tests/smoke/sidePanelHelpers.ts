/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import type { Frame, Page } from 'puppeteer-core';
import { TEST_PAGE_TOOL_COUNT } from './smokeServer.js';

/** A tool call the test page recorded when its `execute` ran. */
export interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
}

declare global {
  interface Window {
    /** Set by `/test-page`: every tool call its `execute` functions ran, in order. */
    __executedTools?: ExecutedToolCall[];
    /** Set by `/test-page` once all its tools are registered. */
    __toolsRegistered?: boolean;
  }
}

export interface PermissionCardSnapshot {
  title: string;
  toolName: string;
  hasAllow: boolean;
  hasDeny: boolean;
  denyText: string;
  /** Text of the "Allow on <host>" session-grant button, or null when it is not offered. */
  alwaysAllowText: string | null;
  isConsequential: boolean;
  warningText: string;
  inputHidden: boolean;
  actionLogWaiting: boolean;
}

/** Selectors shared by several smoke tests. */
export const SELECTORS = {
  composerInput: 'input.text-input__field',
  sendButton: 'button[aria-label="send"]',
  permissionCard: '.tool-permission-card',
  permissionAllow: '.tool-permission-card__btn--allow',
  permissionDeny: '.tool-permission-card__btn--deny',
  permissionAlwaysAllow: '.tool-permission-card__btn--always',
  settingsButton: 'button[aria-label="Settings"]',
  closeSettingsButton: 'button[aria-label="Close settings"]',
  sensitiveAlertsSwitch: '[role="switch"][aria-label="Sensitive action alerts"]',
  newChatButton: 'button[aria-label="Start new chat"]',
} as const;

/**
 * `waitForFunction` options for the side panel page.
 *
 * The side panel page runs in a background tab, because the test page has to be the
 * active tab for the side panel to follow it. Background tabs never fire
 * `requestAnimationFrame`, which is what `waitForFunction` polls with by
 * default, so it would never resolve there. Poll on a timer instead.
 * (`waitForSelector` is fine without this: it watches DOM mutations, as long
 * as the `visible` / `hidden` options are not used.)
 */
export const SIDEBAR_POLLING = { polling: 50 } as const;

/**
 * Clicks the first element matching `selector` (and, when given, whose trimmed
 * text equals `text`). Throws straight away when nothing matches, so a renamed
 * class or label fails with a clear message instead of a later, unrelated timeout.
 *
 * This calls `element.click()` inside the page rather than Puppeteer's
 * `page.click()` / `locator().click()`. Those wait for the element to be
 * visible and send real mouse events, which does not work in the background
 * sidebar tab (see `SIDEBAR_POLLING`).
 */
export async function clickOrThrow(page: Page, selector: string, text?: string): Promise<void> {
  await page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (node) => text === null || node.textContent?.trim() === text
      );
      if (!el) {
        throw new Error(
          `clickOrThrow: no element matches ${selector}${text === null ? '' : ` with text "${text}"`}`
        );
      }
      el.click();
    },
    selector,
    text ?? null
  );
}

/** Waits until the side panel's visible text contains `text`. */
export async function waitForSidebarText(sidebar: Page, text: string): Promise<void> {
  await sidebar.waitForFunction(
    (text) => document.body.innerText.includes(text),
    SIDEBAR_POLLING,
    text
  );
}

/** Reads the tool calls the test page has executed so far, in order. */
export async function readExecutedTools(page: Page | Frame): Promise<ExecutedToolCall[]> {
  return page.evaluate(() => window.__executedTools ?? []);
}

/** Waits until the test page has executed exactly `count` tool calls, and returns them. */
export async function waitForExecutedToolCount(
  page: Page,
  count: number
): Promise<ExecutedToolCall[]> {
  await page.waitForFunction((count) => window.__executedTools?.length === count, {}, count);
  return readExecutedTools(page);
}

export async function dismissConsentScreen(sidebar: Page): Promise<void> {
  await sidebar.waitForFunction(
    () => Boolean(document.querySelector('.consent-view')) && document.body.innerText.includes('Got it'),
    SIDEBAR_POLLING
  );
  await clickOrThrow(sidebar, '.consent-view button', 'Got it');
  await sidebar.waitForFunction(
    () =>
      localStorage.getItem('agentConsent') === 'true' && Boolean(document.querySelector('#welcomeCard')),
    SIDEBAR_POLLING
  );
}

/** Waits until the AttachedTab chip reads "`expectedToolCount` tools". */
export async function waitForAttachedTabTools(
  sidebar: Page,
  expectedToolCount = TEST_PAGE_TOOL_COUNT
): Promise<void> {
  await sidebar.waitForFunction(
    (count) =>
      Boolean(document.querySelector('.attached-tab')) &&
      // Not a plain includes(): "10 tools" must not match "110 tools".
      new RegExp(`(^|\\D)${count} tools\\b`).test(
        document.querySelector('.actions-chip')?.textContent ?? ''
      ),
    SIDEBAR_POLLING,
    expectedToolCount
  );
}

/**
 * Types `promptText` into the composer and presses send.
 *
 * The value is set through the native input setter plus an `input` event so
 * React sees the change; Puppeteer's `page.type()` would need keyboard focus,
 * which the background sidebar tab does not get (see `SIDEBAR_POLLING`).
 */
export async function submitPromptInSidebar(sidebar: Page, promptText: string): Promise<void> {
  const input = await sidebar.waitForSelector(SELECTORS.composerInput);
  assert.ok(input, 'Composer text input is missing');
  await input.evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, promptText);
  await sidebar.waitForSelector(SELECTORS.sendButton);
  await clickOrThrow(sidebar, SELECTORS.sendButton);
}

/** Waits for the permission card and reads what it shows. */
export async function readPermissionCard(sidebar: Page): Promise<PermissionCardSnapshot> {
  const card = await sidebar.waitForSelector(SELECTORS.permissionCard);
  assert.ok(card, 'Permission card is missing');
  return card.evaluate((card, selectors) => {
    const deny = card.querySelector(selectors.permissionDeny);
    const always = card.querySelector(selectors.permissionAlwaysAllow);
    return {
      title: card.querySelector('.tool-permission-card__title')?.textContent?.trim() || '',
      toolName: card.querySelector('.tool-permission-card__tool-name')?.textContent?.trim() || '',
      hasAllow: Boolean(card.querySelector(selectors.permissionAllow)),
      hasDeny: Boolean(deny),
      denyText: deny?.textContent?.trim() || '',
      alwaysAllowText: always?.textContent?.trim() || null,
      isConsequential: card.classList.contains('tool-permission-card--consequential'),
      warningText: card.querySelector('#permission-warning')?.textContent?.trim() || '',
      inputHidden: !document.querySelector(selectors.composerInput),
      actionLogWaiting: document.body.innerText.includes('Waiting for permission'),
    };
  }, SELECTORS);
}

/** Opens Settings from the toolbar and waits for the screen to mount. */
export async function openSettings(sidebar: Page): Promise<void> {
  await clickOrThrow(sidebar, SELECTORS.settingsButton);
  await sidebar.waitForSelector(SELECTORS.closeSettingsButton);
}

/** Closes Settings and waits for the chat view (composer) to come back. */
export async function closeSettings(sidebar: Page): Promise<void> {
  await clickOrThrow(sidebar, SELECTORS.closeSettingsButton);
  await sidebar.waitForSelector(SELECTORS.composerInput);
}

/** The switch's `aria-checked` and the value persisted in localStorage. */
export interface SwitchState {
  ariaChecked: 'true' | 'false';
  stored: string | null;
}

/** Frame-0 tool name as the side panel encodes it for the model (`get_flights` -> `_0_get_flights`). */
export function frame0ToolName(toolName: string): string {
  return `_0_${toolName}`;
}

/**
 * Waits until the Sensitive action alerts switch shows `expected.ariaChecked`,
 * then checks the value saved in localStorage. The app saves the setting while
 * it computes the new state, before the switch re-renders, so it is already
 * stored once the switch has flipped.
 */
export async function waitForSensitiveAlertsSwitch(sidebar: Page, expected: SwitchState): Promise<void> {
  await sidebar.waitForFunction(
    (selector, checked) => document.querySelector(selector)?.getAttribute('aria-checked') === checked,
    SIDEBAR_POLLING,
    SELECTORS.sensitiveAlertsSwitch,
    expected.ariaChecked
  );
  const stored = await sidebar.evaluate(() => localStorage.getItem('sensitiveActionAlerts'));
  assert.equal(stored, expected.stored, 'Unexpected sensitiveActionAlerts value in localStorage');
}

/**
 * Waits until the test page has executed `count` tool calls or a permission
 * card appears, whichever happens first. Lets a test that expects a tool to
 * run without asking fail with "a permission card appeared" instead of a
 * generic timeout.
 */
export async function waitForToolRunOrPrompt(
  page: Page,
  sidebar: Page,
  count: number
): Promise<'executed' | 'prompted'> {
  // Stops whichever wait loses the race.
  const controller = new AbortController();
  try {
    return await Promise.race([
      page
        .waitForFunction(
          (count) => (window.__executedTools?.length ?? 0) >= count,
          { signal: controller.signal },
          count
        )
        .then(() => 'executed' as const),
      sidebar
        .waitForSelector(SELECTORS.permissionCard, { signal: controller.signal })
        .then(() => 'prompted' as const),
    ]);
  } finally {
    controller.abort();
  }
}
