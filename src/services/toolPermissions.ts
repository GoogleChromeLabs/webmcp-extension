/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remembers which tools the user has allowed to run without being asked again.
 *
 * A grant is scoped to one tool of one origin, so allowing `checkout_cart` on
 * `https://shop.example` says nothing about a tool of the same name on any
 * other site, nor about any other tool of that site.
 *
 * The grants live in memory only: they are gone when the panel closes, and
 * `clearSessionToolPermissions` drops them when a chat is reset. Nothing is
 * written to storage, so a grant can never outlive the browsing session.
 */

/** Keys of the tools allowed for the rest of the session. */
const grants = new Set<string>();

/**
 * Builds the key for a grant. `JSON.stringify` keeps the parts apart
 * whatever characters a tool name holds, which a plain separator would not:
 * without it, `('https://a', 'b|c')` and `('https://a|b', 'c')` would collide.
 */
export function toolPermissionKey(origin: string, toolName: string, tabId?: number): string {
  return tabId !== undefined
    ? JSON.stringify([origin, toolName, tabId])
    : JSON.stringify([origin, toolName]);
}

/**
 * Whether the tool may run on this origin without asking.
 *
 * An empty origin is never granted: a grant that is not tied to a site could
 * be used by any site, so those calls keep prompting.
 */
export function isToolAllowedForSession(origin: string, toolName: string, tabId?: number): boolean {
  if (!origin || !toolName) return false;
  if (tabId !== undefined && grants.has(toolPermissionKey(origin, toolName, tabId))) {
    return true;
  }
  return grants.has(toolPermissionKey(origin, toolName));
}

/**
 * Lets the tool run on this origin for the rest of the session.
 * Returns whether the grant was recorded, which it is not without an origin.
 */
export function allowToolForSession(origin: string, toolName: string, tabId?: number): boolean {
  if (!origin || !toolName) return false;
  grants.add(toolPermissionKey(origin, toolName, tabId));
  return true;
}

/** Takes back a single grant, so the tool prompts again. */
export function revokeSessionToolPermission(origin: string, toolName: string, tabId?: number): void {
  if (tabId !== undefined) {
    grants.delete(toolPermissionKey(origin, toolName, tabId));
  }
  grants.delete(toolPermissionKey(origin, toolName));
}

/**
 * Takes back every grant, or every grant belonging to `tabId` (plus unscoped
 * grants) when a specific tab's chat is reset or closed.
 */
export function clearSessionToolPermissions(tabId?: number): void {
  if (tabId === undefined) {
    grants.clear();
    return;
  }
  for (const key of [...grants]) {
    const parsed = JSON.parse(key) as [string, string, number?];
    if (parsed[2] === undefined || parsed[2] === tabId) {
      grants.delete(key);
    }
  }
}

/** The grants held right now, for inspecting session state in tests. */
export function listSessionToolPermissions(
  tabId?: number
): Array<{ origin: string; toolName: string; tabId?: number }> {
  const results: Array<{ origin: string; toolName: string; tabId?: number }> = [];
  for (const key of grants) {
    const [origin, toolName, grantTabId] = JSON.parse(key) as [string, string, number?];
    if (tabId !== undefined && grantTabId !== undefined && grantTabId !== tabId) continue;
    results.push(grantTabId !== undefined ? { origin, toolName, tabId: grantTabId } : { origin, toolName });
  }
  return results;
}

/** Everything the permission rules need to know about one pending tool call. */
export interface ToolPermissionQuery {
  /** The user's "sensitive action alerts" setting. */
  sensitiveActionAlerts?: boolean;
  /** The origin of the top frame of the tab. */
  origin: string;
  toolName: string;
  /** The tab whose chat session owns the grant, when scoped per tab. */
  tabId?: number;
  readOnlyHint?: boolean;
  /**
   * The page's `consequentialHint`: this call may do something that cannot be
   * undone. Confirmation for these is mandatory and cannot be switched off.
   */
  consequentialHint?: boolean;
  /** The frame that owns the tool. 0 is the top frame. */
  toolFrameId?: number;
}

/**
 * Whether a session grant is allowed to apply to this call at all.
 *
 * Three things have to hold, and each one is a way the grant could otherwise
 * mean something other than what the user was shown:
 *
 * - **There is an origin.** Nothing to scope the grant to otherwise.
 * - **The tool is in the top frame.** `origin` describes the top frame only,
 *   so it says nothing about a tool inside a cross-origin iframe. Keying those
 *   on it would let a grant for the page's own tool authorise a same-named tool
 *   belonging to an embedded third party.
 * - **It is not consequential.** An action that cannot be undone is worth a
 *   decision every single time; there is no "and don't ask again" for those.
 *
 * The same test decides whether to offer the choice and whether to honour it,
 * so a grant can never be honoured where it would not have been offered.
 */
export function isGrantEligible({
  origin,
  toolName,
  toolFrameId = 0,
  consequentialHint,
}: ToolPermissionQuery): boolean {
  if (consequentialHint === true) return false;
  return Boolean(origin) && Boolean(toolName) && toolFrameId === 0;
}

/**
 * Whether this call has to be put to the user. The single source of truth for
 * the prompt, so the rule can be tested directly rather than mirrored.
 */
export function needsToolPermission(query: ToolPermissionQuery): boolean {
  // Checked before anything else, so that neither the alerts setting, a
  // read-only claim, nor a standing grant can wave an irreversible action
  // through. This is the one prompt the user cannot turn off.
  if (query.consequentialHint === true) return true;
  if (!query.sensitiveActionAlerts) return false;
  // Anything but an explicit read-only hint is treated as changing something.
  if (query.readOnlyHint === true) return false;
  return !(isGrantEligible(query) && isToolAllowedForSession(query.origin, query.toolName, query.tabId));
}

/** What the user chose when asked to let a tool run. */
export type ToolPermissionDecision = 'allow' | 'allowAlways' | 'deny';

/**
 * Records whatever standing permission the decision earns, and reports whether
 * the call may now run. Kept here rather than in the hook so that "only
 * `allowAlways` grants, and only where a grant is eligible" is covered by a
 * test instead of resting on two lines of untested wiring.
 */
export function applyToolPermissionDecision(
  decision: ToolPermissionDecision,
  query: ToolPermissionQuery
): boolean {
  if (decision === 'deny') return false;
  // A plain `allow` runs the tool once and is deliberately not remembered.
  if (decision === 'allowAlways' && isGrantEligible(query)) {
    allowToolForSession(query.origin, query.toolName, query.tabId);
  }
  return true;
}

/**
 * The origin of a page URL, or an empty string when it has none — a `chrome://`
 * page, a new tab, or anything else that cannot be parsed.
 */
export function originOfUrl(url?: string | null): string {
  if (!url) return '';
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}
