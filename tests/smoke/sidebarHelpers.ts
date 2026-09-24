/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Page } from 'puppeteer-core';
import { evaluate, waitForCondition } from './wait.js';
import { TEST_PAGE_TOOL_COUNT } from './smokeServer.js';

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

/** A tool call the test page recorded when its `execute` ran. */
export interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
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
 * A browser-side expression resolving to the tab id of `/test-page`, for use
 * inside `chrome.*` calls made from the side panel.
 */
export const TEST_PAGE_TAB_ID_EXPR = `(await chrome.tabs.query({})).find(t => t.url && t.url.includes('/test-page'))?.id`;

/**
 * Clicks the first element matching `selector` (and, when given, whose trimmed
 * text equals `text`). Throws straight away when nothing matches, so a renamed
 * class or label fails with a clear message instead of a later, unrelated timeout.
 *
 * This calls `element.click()` inside the page rather than Puppeteer's
 * `page.click()` / `locator().click()`. Those wait for the element to be
 * visible and send real mouse events, and sidebar.html runs in a background
 * tab (the test page has to be the active tab for the side panel to follow
 * it), so they time out there.
 */
export async function clickOrThrow(
  page: Page,
  selector: string,
  text?: string
): Promise<void> {
  await evaluate(page, `(() => {
      const selector = ${JSON.stringify(selector)};
      const text = ${JSON.stringify(text ?? null)};
      const el = [...document.querySelectorAll(selector)].find(
        (node) => text === null || node.textContent?.trim() === text
      );
      if (!el) {
        throw new Error('clickOrThrow: no element matches ' + selector + (text === null ? '' : ' with text "' + text + '"'));
      }
      el.click();
    })()`
  );
}

/** Waits until an element matching `selector` exists in the given page. */
export async function waitForSelector(
  page: Page,
  selector: string,
  description = `${selector} to appear`
): Promise<void> {
  await waitForCondition(
    () => evaluate<boolean>(page, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    description
  );
}

/** Waits until the side panel's visible text contains `text`. */
export async function waitForSidebarText(
  sidebar: Page,
  text: string,
  description = `side panel to show "${text}"`
): Promise<void> {
  await waitForCondition(
    () =>
      evaluate<boolean>(sidebar, `document.body.innerText.includes(${JSON.stringify(text)})`
      ),
    description
  );
}

/** Reads the tool calls the test page has executed so far, in order. */
export async function readExecutedTools(
  page: Page
): Promise<ExecutedToolCall[]> {
  return evaluate<ExecutedToolCall[]>(page, `window.__executedTools ?? []`
  );
}

/** Waits until the test page has executed exactly `count` tool calls, and returns them. */
export async function waitForExecutedToolCount(
  page: Page,
  count: number
): Promise<ExecutedToolCall[]> {
  return waitForCondition(async () => {
    const calls = await readExecutedTools(page);
    return calls.length === count ? calls : null;
  }, `test page to have executed ${count} tool call(s)`);
}

export async function dismissConsentScreen(
  sidebar: Page
): Promise<void> {
  await waitForCondition(async () => {
    return await evaluate<boolean>(sidebar, `Boolean(document.querySelector('.consent-view') && document.body.innerText.includes('Got it'))`
    );
  }, 'ConsentScreen to mount inside sidebar.html');

  await clickOrThrow(sidebar, '.consent-view button', 'Got it');

  await waitForCondition(async () => {
    return await evaluate<boolean>(sidebar, `localStorage.getItem('agentConsent') === 'true' && Boolean(document.querySelector('#welcomeCard'))`
    );
  }, 'ConsentScreen dismissal to persist agentConsent and render #welcomeCard');
}

export async function waitForAttachedTabTools(
  sidebar: Page,
  expectedToolCount = TEST_PAGE_TOOL_COUNT
): Promise<void> {
  const expectedLabel = `${expectedToolCount} tools`;
  await waitForCondition(async () => {
    return await evaluate<boolean>(sidebar, `Boolean(
        document.querySelector('.attached-tab') &&
        // Not a plain includes(): "10 tools" must not match "110 tools".
        /(^|\\D)${expectedToolCount} tools\\b/.test(document.querySelector('.actions-chip')?.textContent ?? '')
      )`
    );
  }, `AttachedTab chip to read "${expectedLabel}"`);
}

/**
 * Types `promptText` into the composer and presses send.
 *
 * The value is set through the native input setter plus an `input` event so
 * React sees the change; Puppeteer's `page.type()` would need keyboard focus,
 * which the background sidebar tab does not get (see `clickOrThrow`).
 */
export async function submitPromptInSidebar(
  sidebar: Page,
  promptText: string
): Promise<void> {
  await waitForSelector(sidebar, SELECTORS.composerInput, 'Composer text input to be present');
  await evaluate(sidebar, `(() => {
      const input = document.querySelector(${JSON.stringify(SELECTORS.composerInput)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(promptText)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  );
  await waitForSelector(sidebar, SELECTORS.sendButton, 'Toolbar button to switch to aria-label="send"');
  await clickOrThrow(sidebar, SELECTORS.sendButton);
}

export async function readPermissionCard(
  sidebar: Page,
  description: string
): Promise<PermissionCardSnapshot> {
  return waitForCondition(async () => {
    return await evaluate<PermissionCardSnapshot | null>(sidebar, `(() => {
        const card = document.querySelector(${JSON.stringify(SELECTORS.permissionCard)});
        if (!card) return null;
        const allow = card.querySelector(${JSON.stringify(SELECTORS.permissionAllow)});
        const deny = card.querySelector(${JSON.stringify(SELECTORS.permissionDeny)});
        const always = card.querySelector(${JSON.stringify(SELECTORS.permissionAlwaysAllow)});
        return {
          title: card.querySelector('.tool-permission-card__title')?.textContent?.trim() || '',
          toolName: card.querySelector('.tool-permission-card__tool-name')?.textContent?.trim() || '',
          hasAllow: Boolean(allow),
          hasDeny: Boolean(deny),
          denyText: deny?.textContent?.trim() || '',
          alwaysAllowText: always?.textContent?.trim() || null,
          isConsequential: card.classList.contains('tool-permission-card--consequential'),
          warningText: card.querySelector('#permission-warning')?.textContent?.trim() || '',
          inputHidden: !document.querySelector(${JSON.stringify(SELECTORS.composerInput)}),
          actionLogWaiting: document.body.innerText.includes('Waiting for permission'),
        };
      })()`
    );
  }, description);
}

/** Opens Settings from the toolbar and waits for the screen to mount. */
export async function openSettings(sidebar: Page): Promise<void> {
  await clickOrThrow(sidebar, SELECTORS.settingsButton);
  await waitForSelector(sidebar, SELECTORS.closeSettingsButton, 'SettingsScreen to open');
}

/** Closes Settings and waits for the chat view (composer) to come back. */
export async function closeSettings(sidebar: Page): Promise<void> {
  await clickOrThrow(sidebar, SELECTORS.closeSettingsButton);
  await waitForSelector(sidebar, SELECTORS.composerInput, 'chat view to return after closing settings');
}

/** The switch's `aria-checked` and the value persisted in localStorage. */
export interface SwitchState {
  ariaChecked: string | null;
  stored: string | null;
}

/** Frame-0 tool name as the side panel encodes it for the model (`get_flights` -> `_0_get_flights`). */
export function frame0ToolName(toolName: string): string {
  return `_0_${toolName}`;
}

/** Reads the Sensitive action alerts switch as the user (and the app) sees it. */
async function readSensitiveAlertsSwitch(
  sidebar: Page
): Promise<SwitchState> {
  return evaluate<SwitchState>(sidebar, `({
      ariaChecked: document.querySelector(${JSON.stringify(SELECTORS.sensitiveAlertsSwitch)})?.getAttribute('aria-checked') ?? null,
      stored: localStorage.getItem('sensitiveActionAlerts'),
    })`
  );
}

/** Waits until the Sensitive action alerts switch and its stored value both match `expected`. */
export async function waitForSensitiveAlertsSwitch(
  sidebar: Page,
  expected: SwitchState
): Promise<void> {
  let last: SwitchState | null = null;
  try {
    await waitForCondition(async () => {
      last = await readSensitiveAlertsSwitch(sidebar);
      return last.ariaChecked === expected.ariaChecked && last.stored === expected.stored;
    }, `Sensitive action alerts switch to be ${JSON.stringify(expected)}`);
  } catch (err) {
    throw new Error(`${(err as Error).message}; last seen ${JSON.stringify(last)}`);
  }
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
  return waitForCondition(async () => {
    if ((await readExecutedTools(page)).length >= count) return 'executed' as const;
    const prompted = await evaluate<boolean>(
      sidebar,
      `Boolean(document.querySelector(${JSON.stringify(SELECTORS.permissionCard)}))`
    );
    return prompted ? ('prompted' as const) : null;
  }, `test page to execute ${count} tool call(s) or a permission card to appear`);
}
