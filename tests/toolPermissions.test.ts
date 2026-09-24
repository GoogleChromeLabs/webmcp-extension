/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { Switch } from '../src/sidepanel/components/Switch.js';
import { SettingsScreen } from '../src/sidepanel/screens/SettingsScreen.js';
import { AllowToolPermissionCard } from '../src/sidepanel/components/AllowToolPermissionCard.js';
import { Toolbar } from '../src/sidepanel/components/Toolbar.js';
import { ChatBubble } from '../src/sidepanel/components/ChatBubble.js';
import {
  allowToolForSession,
  applyToolPermissionDecision,
  clearSessionToolPermissions,
  isGrantEligible,
  isToolAllowedForSession,
  needsToolPermission,
  originOfUrl,
} from '../src/sidepanel/services/toolPermissions.js';
import { useAgentSession, UseAgentSessionReturn } from '../src/sidepanel/hooks/useAgentSession.js';
import { WebMCPTool } from '../src/sidepanel/types/index.js';

/** The tab whose chat owns the grants in the tests that need only one. */
const TAB = 1;

test('Switch toggles properly on click', () => {
  let toggledValue: boolean | null = null;
  const switchComponent = Switch({
    checked: false,
    onChange: (val: boolean) => {
      toggledValue = val;
    },
    'aria-label': 'Enable sensitive actions',
  });

  const html = renderToString(switchComponent);
  assert.ok(html.includes('aria-checked="false"'));
  assert.ok(!html.includes('cdds-switch--checked'));

  // Trigger click handler from the rendered button component
  switchComponent.props.onClick();
  assert.equal(toggledValue, true);
});

test('a disabled Switch stays focusable and ignores clicks and keys', () => {
  let changes = 0;
  const switchComponent = Switch({
    checked: false,
    onChange: () => changes++,
    disabled: true,
    'aria-label': 'On-device model',
  });

  const html = renderToString(switchComponent);
  assert.ok(html.includes('aria-disabled="true"'));
  // No `disabled` attribute, which would take it out of the tab order.
  assert.doesNotMatch(html, /\sdisabled(=|\s|>)/);

  switchComponent.props.onClick();
  let prevented = 0;
  for (const key of [' ', 'Enter']) {
    switchComponent.props.onKeyDown({ key, preventDefault: () => prevented++ });
  }
  assert.equal(changes, 0);
  // The keys are still swallowed, so the button does not click itself either.
  assert.equal(prevented, 2);

  const enabled = renderToString(Switch({ checked: false, onChange: () => {}, 'aria-label': 'On-device model' }));
  assert.ok(!enabled.includes('aria-disabled'));
});

test('SettingsScreen renders the permissions and model sections', () => {
  let toggled = false;
  let closed = false;

  const screen = React.createElement(SettingsScreen, {
    sensitiveActionAlerts: true,
    onToggleSensitiveActionAlerts: () => {
      toggled = true;
    },
    onDeviceModel: false,
    onToggleOnDeviceModel: () => { },
    onDeviceModelSupported: true,
    onClose: () => {
      closed = true;
    },
  });

  const html = renderToString(screen);

  // Must contain Settings header and Close button
  assert.ok(html.includes('Settings'));
  assert.ok(html.includes('aria-label="Close settings"'));

  // Must contain Permissions and Sensitive action alerts
  assert.ok(html.includes('Permissions'));
  assert.ok(html.includes('Sensitive action alerts'));
  assert.ok(
    html.includes(
      'Get a prompt before tools make changes to your data or accounts. Some external tools may not support this.'
    )
  );
  assert.ok(html.includes('cdds-switch--checked'));

  // Must contain the Model section with the on-device model toggle
  assert.ok(html.includes('On-device model'));
  assert.ok(html.includes('Run the model in your browser with the Prompt API'));

  // Must NOT contain unrequested settings sections like Preferences, Tabs, Microphone, Location
  assert.ok(!html.includes('Show used tools in the log'));
  assert.ok(!html.includes('Share current tab by default'));
  assert.ok(!html.includes('Microphone'));
  assert.ok(!html.includes('Tool list'));
  assert.ok(!html.includes('Models'));

  // Verify interaction callbacks
  screen.props.onToggleSensitiveActionAlerts();
  assert.equal(toggled, true);
  screen.props.onClose();
  assert.equal(closed, true);
});

test('SettingsScreen locks the model switch while a response is in progress', () => {
  const render = (responseInProgress: boolean) =>
    renderToString(
      React.createElement(SettingsScreen, {
        sensitiveActionAlerts: true,
        onToggleSensitiveActionAlerts: () => { },
        onDeviceModel: true,
        onToggleOnDeviceModel: () => { },
        onDeviceModelSupported: true,
        responseInProgress,
        onClose: () => { },
      })
    );
  const modelSwitch = (html: string) => /<button[^>]*aria-label="On-device model"[^>]*>/.exec(html)?.[0] ?? '';
  const alertsSwitch = (html: string) => /<button[^>]*aria-label="Sensitive action alerts"[^>]*>/.exec(html)?.[0] ?? '';

  const busy = render(true);
  assert.match(modelSwitch(busy), /aria-disabled="true"/);
  assert.ok(busy.includes('Can be changed once the current response has finished.'));
  // The switch points at why it is locked, so a screen reader announces it.
  const describedBy = /aria-describedby="([^"]*)"/.exec(modelSwitch(busy))?.[1].split(' ') ?? [];
  assert.equal(describedBy.length, 2);
  const lockedNote = new RegExp(`id="${describedBy[1]}"[^>]*>\\s*Can be changed once the current response has finished.`);
  assert.match(busy, lockedNote);
  // Only the backend is locked: permission alerts can still be changed.
  assert.doesNotMatch(alertsSwitch(busy), /disabled/);

  const idle = render(false);
  assert.doesNotMatch(modelSwitch(idle), /disabled/);
  assert.ok(!idle.includes('Can be changed once the current response has finished.'));
  assert.equal(/aria-describedby="([^"]*)"/.exec(modelSwitch(idle))?.[1].split(' ').length, 1);
});

test('AllowToolPermissionCard triggers onAllow and onDeny callbacks', () => {
  let allowed = false;
  let denied = false;

  const card = React.createElement(AllowToolPermissionCard, {
    toolName: 'transfer_funds',
    toolDescription: 'Transfers money between specified accounts.',
    onAllow: () => {
      allowed = true;
    },
    onDeny: () => {
      denied = true;
    },
  });

  const html = renderToString(card);
  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('Let this tool complete task for you'));
  assert.ok(html.includes('transfer_funds'));
  assert.ok(html.includes('Transfers money between specified accounts.'));
  assert.ok(html.includes('Don’t allow'));
  assert.ok(html.includes('Allow'));

  card.props.onAllow();
  assert.equal(allowed, true);
  card.props.onDeny();
  assert.equal(denied, true);
});

test('ChatBubble swaps input field with AllowToolPermissionCard when permissionProps is passed', () => {
  let allowClicked = false;
  let denyClicked = false;

  const bubbleWithPermission = React.createElement(ChatBubble, {
    showTab: true,
    tabProps: { domain: 'shopping.com', toolsCountLabel: '2 tools', hasTools: true },
    permissionProps: {
      toolName: 'checkout_cart',
      toolDescription: 'Purchases all items in your cart.',
      onAllow: () => {
        allowClicked = true;
      },
      onDeny: () => {
        denyClicked = true;
      },
    },
  });

  const html = renderToString(bubbleWithPermission);
  assert.ok(html.includes('shopping.com'));
  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('checkout_cart'));
  assert.ok(html.includes('Purchases all items in your cart.'));
  assert.ok(!html.includes('chat-bubble__input-field'));

  bubbleWithPermission.props.permissionProps?.onAllow();
  assert.equal(allowClicked, true);
  bubbleWithPermission.props.permissionProps?.onDeny();
  assert.equal(denyClicked, true);
});

test('Toolbar renders settings gear icon on the left when onSettingsClick is provided', () => {
  let settingsClicked = false;

  const toolbar = React.createElement(Toolbar, {
    actionVariant: 'send',
    onActionClick: () => {},
    onSettingsClick: () => {
      settingsClicked = true;
    },
  });

  const html = renderToString(toolbar);
  assert.ok(html.includes('toolbar__settings-btn'));
  assert.ok(html.includes('aria-label="Settings"'));

  toolbar.props.onSettingsClick?.();
  assert.equal(settingsClicked, true);
});

test('Readonly tools vs non-readonly tools distinction follows WebMCP readOnlyHint specification', () => {
  clearSessionToolPermissions();

  const tools: WebMCPTool[] = [
    {
      name: 'get_weather',
      description: 'Gets the current weather for a city.',
      readOnlyHint: true,
    },
    {
      name: 'send_email',
      description: 'Sends an email to a recipient.',
      readOnlyHint: false,
    },
    {
      name: 'delete_file',
      description: 'Deletes a specified file.',
    },
  ];

  // The real decision function, not a copy of it: this has to fail if the rule
  // in production changes.
  const requiresPermissionPrompt = (tool: WebMCPTool, sensitiveActionAlerts: boolean): boolean =>
    needsToolPermission({
      sensitiveActionAlerts,
      origin: 'https://mail.example',
      toolName: tool.name,
      tabId: TAB,
      readOnlyHint: tool.readOnlyHint,
    });

  // When sensitiveActionAlerts is TRUE:
  // get_weather is readonly -> NO prompt
  assert.equal(requiresPermissionPrompt(tools[0], true), false);
  // send_email is readOnlyHint: false -> PROMPT
  assert.equal(requiresPermissionPrompt(tools[1], true), true);
  // delete_file has undefined readOnlyHint -> defaults to sensitive/mutating -> PROMPT
  assert.equal(requiresPermissionPrompt(tools[2], true), true);

  // When sensitiveActionAlerts is FALSE:
  // None require prompt
  assert.equal(requiresPermissionPrompt(tools[0], false), false);
  assert.equal(requiresPermissionPrompt(tools[1], false), false);
  assert.equal(requiresPermissionPrompt(tools[2], false), false);
});

test('session grants are scoped to one tool of one origin in one tab', () => {
  clearSessionToolPermissions();

  assert.equal(isToolAllowedForSession('https://shop.example', 'checkout_cart', TAB), false);
  assert.equal(allowToolForSession('https://shop.example', 'checkout_cart', TAB), true);
  assert.equal(isToolAllowedForSession('https://shop.example', 'checkout_cart', TAB), true);

  // Another tool of the same site is still asked about.
  assert.equal(isToolAllowedForSession('https://shop.example', 'delete_account', TAB), false);
  // So is the same tool name on another site, and on another scheme or port
  // of the same host, which are separate origins.
  assert.equal(isToolAllowedForSession('https://evil.example', 'checkout_cart', TAB), false);
  assert.equal(isToolAllowedForSession('http://shop.example', 'checkout_cart', TAB), false);
  assert.equal(isToolAllowedForSession('https://shop.example:8443', 'checkout_cart', TAB), false);
  // And the same tool of the same site in another tab's chat.
  assert.equal(isToolAllowedForSession('https://shop.example', 'checkout_cart', TAB + 1), false);
});

test('a grant cannot be made or matched without an origin', () => {
  clearSessionToolPermissions();

  assert.equal(allowToolForSession('', 'checkout_cart', TAB), false);
  assert.equal(isToolAllowedForSession('', 'checkout_cart', TAB), false);

  // A tool with no name cannot be granted either.
  assert.equal(allowToolForSession('https://shop.example', '', TAB), false);
  assert.equal(isToolAllowedForSession('https://shop.example', '', TAB), false);
});

test('keys keep the origin and the tool name apart whatever they contain', () => {
  clearSessionToolPermissions();

  // A naive `origin + separator + toolName` key would make these two the same.
  allowToolForSession('https://a.example', '|weird|tool', TAB);
  assert.equal(isToolAllowedForSession('https://a.example|', 'weird|tool', TAB), false);
  assert.equal(isToolAllowedForSession('https://a.example', '|weird|tool', TAB), true);
});

test('clearSessionToolPermissions drops every grant', () => {
  clearSessionToolPermissions();

  allowToolForSession('https://a.example', 'tool_one', 1);
  allowToolForSession('https://b.example', 'tool_two', 2);

  clearSessionToolPermissions();
  assert.equal(isToolAllowedForSession('https://a.example', 'tool_one', 1), false);
  assert.equal(isToolAllowedForSession('https://b.example', 'tool_two', 2), false);
});

test('originOfUrl keeps real origins and rejects the ones that cannot be scoped', () => {
  assert.equal(originOfUrl('https://example.com/cart?a=1#top'), 'https://example.com');
  assert.equal(originOfUrl('http://example.com:8080/x'), 'http://example.com:8080');
  assert.equal(originOfUrl('New Tab'), '');
  assert.equal(originOfUrl(''), '');
  assert.equal(originOfUrl(undefined), '');
  // A sandboxed document is opaque: every one of them would share one key.
  assert.equal(originOfUrl('data:text/html,<p>hi</p>'), '');
});

test('the permission gate skips the prompt once a tool is granted for the origin', () => {
  clearSessionToolPermissions();

  // The real gate from production, not a copy: deleting or inverting the check
  // in `needsToolPermission` has to break this test.
  const ask = (origin: string, tool: WebMCPTool, sensitiveActionAlerts: boolean): boolean =>
    needsToolPermission({
      sensitiveActionAlerts,
      origin,
      toolName: tool.name,
      tabId: TAB,
      readOnlyHint: tool.readOnlyHint,
    });

  const tool: WebMCPTool = { name: 'checkout_cart', description: 'Buys the cart.' };

  assert.equal(ask('https://shop.example', tool, true), true);
  allowToolForSession('https://shop.example', tool.name, TAB);
  assert.equal(ask('https://shop.example', tool, true), false);
  // The grant does not leak to another site.
  assert.equal(ask('https://other.example', tool, true), true);
  // Nor does it survive the alerts setting being turned back on after a reset.
  clearSessionToolPermissions();
  assert.equal(ask('https://shop.example', tool, true), true);
});

test('a grant for the page never covers a tool inside a cross-origin iframe', () => {
  clearSessionToolPermissions();

  // `origin` only ever describes the top frame, so a tool belonging to an
  // embedded third party must keep prompting however the page is granted.
  const query = (toolFrameId: number) => ({
    sensitiveActionAlerts: true,
    origin: 'https://shop.example',
    toolName: 'submit_form',
    tabId: TAB,
    toolFrameId,
  });

  allowToolForSession('https://shop.example', 'submit_form', TAB);

  // The page's own tool is covered...
  assert.equal(needsToolPermission(query(0)), false);
  // ...the identically named tool in an iframe is not.
  assert.equal(needsToolPermission(query(7)), true);

  // The choice is not even offered for the iframe tool, so a grant that would
  // not be honoured can never be recorded in the first place.
  assert.equal(isGrantEligible(query(0)), true);
  assert.equal(isGrantEligible(query(7)), false);
});

test('grants are only eligible where they would mean what the button says', () => {
  const base = { origin: 'https://shop.example', toolName: 'checkout_cart', tabId: TAB };

  assert.equal(isGrantEligible(base), true);
  // No origin to scope it to.
  assert.equal(isGrantEligible({ ...base, origin: '' }), false);
  // No tool name to key it on.
  assert.equal(isGrantEligible({ ...base, toolName: '' }), false);
  // Not the top frame.
  assert.equal(isGrantEligible({ ...base, toolFrameId: 1 }), false);
});

test('the gate stays shut for read-only tools and open when alerts are off', () => {
  clearSessionToolPermissions();

  const base = {
    origin: 'https://shop.example',
    toolName: 'get_weather',
    tabId: TAB,
    sensitiveActionAlerts: true,
  };

  // Read-only never prompts and never needs a grant.
  assert.equal(needsToolPermission({ ...base, readOnlyHint: true }), false);
  // Alerts off never prompts, and must not quietly record a grant either.
  assert.equal(needsToolPermission({ ...base, sensitiveActionAlerts: false }), false);
  assert.equal(isToolAllowedForSession(base.origin, base.toolName, TAB), false);
});

test('only the always choice earns a standing grant', () => {
  const query = { origin: 'https://shop.example', toolName: 'checkout_cart', tabId: TAB };
  const granted = () => isToolAllowedForSession(query.origin, query.toolName, TAB);

  clearSessionToolPermissions();
  assert.equal(applyToolPermissionDecision('deny', query), false);
  assert.equal(granted(), false, 'deny must not grant');

  clearSessionToolPermissions();
  assert.equal(applyToolPermissionDecision('allow', query), true);
  assert.equal(granted(), false, 'a one-off allow must not grant');

  clearSessionToolPermissions();
  assert.equal(applyToolPermissionDecision('allowAlways', query), true);
  assert.equal(granted(), true);
});

test('an always choice records nothing where a grant would not be eligible', () => {
  // The button is not offered in these cases, but the rule is enforced here too
  // so that the two can never drift apart.
  for (const ineligible of [
    { origin: '', toolName: 'checkout_cart', tabId: TAB },
    { origin: 'https://shop.example', toolName: 'checkout_cart', tabId: TAB, toolFrameId: 7 },
    { origin: 'https://shop.example', toolName: 'checkout_cart', tabId: TAB, consequentialHint: true },
  ]) {
    clearSessionToolPermissions();
    // The call is still allowed to run this once...
    assert.equal(applyToolPermissionDecision('allowAlways', ineligible), true);
    // ...but nothing is remembered.
    assert.equal(
      isToolAllowedForSession(ineligible.origin, ineligible.toolName, TAB),
      false,
      JSON.stringify(ineligible)
    );
  }
});

test('a consequential tool always asks, whatever the settings say', () => {
  clearSessionToolPermissions();

  const consequential = {
    origin: 'https://bank.example',
    toolName: 'transfer_funds',
    tabId: TAB,
    consequentialHint: true,
  };

  // Alerts on: asks.
  assert.equal(needsToolPermission({ ...consequential, sensitiveActionAlerts: true }), true);
  // Alerts off: still asks. This is the prompt the toggle cannot switch off.
  assert.equal(needsToolPermission({ ...consequential, sensitiveActionAlerts: false }), true);
  // Even if the page also claims the tool is read-only, which is contradictory:
  // the more cautious of the two hints wins.
  assert.equal(
    needsToolPermission({ ...consequential, sensitiveActionAlerts: false, readOnlyHint: true }),
    true
  );
});

test('a consequential tool can never be granted for the session', () => {
  clearSessionToolPermissions();

  const consequential = {
    sensitiveActionAlerts: true,
    origin: 'https://bank.example',
    toolName: 'transfer_funds',
    tabId: TAB,
    consequentialHint: true,
  };

  // The choice is never offered...
  assert.equal(isGrantEligible(consequential), false);
  // ...choosing it anyway records nothing...
  assert.equal(applyToolPermissionDecision('allowAlways', consequential), true);
  assert.equal(isToolAllowedForSession('https://bank.example', 'transfer_funds', TAB), false);

  // ...and a grant that somehow exists for that name is ignored, so a tool that
  // becomes consequential after being granted starts asking again.
  allowToolForSession('https://bank.example', 'transfer_funds', TAB);
  assert.equal(needsToolPermission(consequential), true);
  // The same name without the hint is still covered by that grant.
  assert.equal(
    needsToolPermission({ ...consequential, consequentialHint: false }),
    false
  );
});

test('a non-consequential tool keeps the session grant behaviour', () => {
  clearSessionToolPermissions();

  // Guards against a fix for consequential tools quietly disabling the feature.
  const ordinary = {
    sensitiveActionAlerts: true,
    origin: 'https://shop.example',
    toolName: 'add_to_cart',
    tabId: TAB,
  };

  assert.equal(isGrantEligible(ordinary), true);
  assert.equal(isGrantEligible({ ...ordinary, consequentialHint: false }), true);
  assert.equal(needsToolPermission(ordinary), true);
  applyToolPermissionDecision('allowAlways', ordinary);
  assert.equal(needsToolPermission(ordinary), false);
});

/**
 * Finds a rendered element by class name in a returned element tree, so a test
 * can invoke the handler the component actually attached rather than the
 * callback it passed in — the latter passes even if the `onClick` is removed.
 */
function findByClass(
  node: unknown,
  className: string
): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as { props?: { className?: unknown; children?: unknown } };
  if (typeof el.props?.className === 'string' && el.props.className.includes(className)) {
    return el as { props: Record<string, unknown> };
  }
  const children = el.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test('AllowToolPermissionCard offers the session choice with the site name and wires it up', () => {
  let alwaysAllowed = 0;

  const props = {
    toolName: 'checkout_cart',
    toolDescription: 'Purchases all items in your cart.',
    origin: 'https://shop.example',
    onAllow: () => {},
    onAlwaysAllow: () => {
      alwaysAllowed++;
    },
    onDeny: () => {},
  };

  const html = renderToString(React.createElement(AllowToolPermissionCard, props));
  // The scope is on the button itself, not hidden in a tooltip.
  assert.ok(html.includes('Allow on shop.example for this chat'));
  assert.ok(html.includes('tool-permission-card__btn--always'));
  // The other two choices are still there.
  assert.ok(html.includes('Don’t allow'));
  assert.ok(html.includes('>Allow</button>'));
  // It no longer claims to last forever.
  assert.ok(!html.includes('Always allow'));

  // Invoke the button's own handler, which proves the component wired it.
  const button = findByClass(AllowToolPermissionCard(props), 'tool-permission-card__btn--always');
  assert.ok(button, 'the always-allow button should be rendered');
  (button!.props.onClick as () => void)();
  assert.equal(alwaysAllowed, 1);
});

test('AllowToolPermissionCard hides the session choice when there is nothing to remember it against', () => {
  const withoutCallback = renderToString(
    React.createElement(AllowToolPermissionCard, {
      toolName: 'checkout_cart',
      origin: 'https://shop.example',
      onAllow: () => {},
      onDeny: () => {},
    })
  );
  assert.ok(!withoutCallback.includes('tool-permission-card__btn--always'));
  assert.ok(!withoutCallback.includes('for this chat'));

  // With a callback but no origin the button still shows, with wording that
  // does not claim a site.
  const withoutOrigin = renderToString(
    React.createElement(AllowToolPermissionCard, {
      toolName: 'checkout_cart',
      onAllow: () => {},
      onAlwaysAllow: () => {},
      onDeny: () => {},
    })
  );
  assert.ok(withoutOrigin.includes('Allow for this chat'));
});

test('ChatBubble forwards the session choice to the permission card', () => {
  let alwaysClicked = false;

  const permissionProps = {
    toolName: 'checkout_cart',
    toolDescription: 'Purchases all items in your cart.',
    origin: 'https://shopping.com',
    onAllow: () => {},
    onAlwaysAllow: () => {
      alwaysClicked = true;
    },
    onDeny: () => {},
  };

  const html = renderToString(
    React.createElement(ChatBubble, {
      showTab: true,
      tabProps: { domain: 'shopping.com', toolsCountLabel: '2 tools', hasTools: true },
      permissionProps,
    })
  );
  assert.ok(html.includes('Allow on shopping.com for this chat'));

  // Again through the rendered button, so this covers ChatBubble's plumbing.
  const button = findByClass(
    AllowToolPermissionCard(permissionProps),
    'tool-permission-card__btn--always'
  );
  (button!.props.onClick as () => void)();
  assert.equal(alwaysClicked, true);
});

test('a consequential tool gets the warning card and no session-grant button', () => {
  const props = {
    toolName: 'transfer_funds',
    toolDescription: 'Moves money between accounts.',
    origin: 'https://bank.example',
    consequential: true,
    onAllow: () => {},
    // Supplied on purpose: the card must refuse to draw the button anyway, so a
    // caller that forgets the rule cannot reintroduce it.
    onAlwaysAllow: () => {},
    onDeny: () => {},
  };

  const html = renderToString(React.createElement(AllowToolPermissionCard, props));

  // The warning is stated plainly and names what could go wrong.
  assert.ok(html.includes('This action may be irreversible'));
  assert.ok(html.includes('may not'));
  assert.ok(html.includes('reverse'));
  assert.ok(html.includes('tool-permission-card--consequential'));
  assert.ok(html.includes('tool-permission-card__warning'));
  // The user is told why this one keeps asking.
  assert.ok(html.includes('even if alerts are turned off'));
  // The warning is announced with the dialog.
  assert.ok(html.includes('aria-describedby="permission-warning"'));

  // No way to stop being asked.
  assert.ok(!html.includes('tool-permission-card__btn--always'));
  assert.ok(!html.includes('for this chat'));
  assert.equal(findByClass(AllowToolPermissionCard(props), 'tool-permission-card__btn--always'), null);

  // Both decisions are still available.
  assert.ok(html.includes('>Allow</button>'));
  assert.ok(html.includes('Cancel'));
});

test('the ordinary card keeps its own wording and is not marked consequential', () => {
  const html = renderToString(
    React.createElement(AllowToolPermissionCard, {
      toolName: 'add_to_cart',
      toolDescription: 'Adds an item to the cart.',
      origin: 'https://shop.example',
      onAllow: () => {},
      onAlwaysAllow: () => {},
      onDeny: () => {},
    })
  );

  assert.ok(!html.includes('tool-permission-card--consequential'));
  assert.ok(!html.includes('tool-permission-card__warning'));
  assert.ok(html.includes('Allow tool actions'));
  assert.ok(html.includes('aria-describedby="permission-details"'));
  // The session grant is still offered for an ordinary tool.
  assert.ok(html.includes('Allow on shop.example for this chat'));
});

test('per-tab session grants isolate chats across tabs and only clear the reset tab', () => {
  clearSessionToolPermissions();

  // Grant checkout_cart on shop.example in tab 1's chat.
  applyToolPermissionDecision('allowAlways', {
    sensitiveActionAlerts: true,
    origin: 'https://shop.example',
    toolName: 'checkout_cart',
    tabId: 1,
  });

  // Tab 1's chat skips the prompt...
  assert.equal(
    needsToolPermission({
      sensitiveActionAlerts: true,
      origin: 'https://shop.example',
      toolName: 'checkout_cart',
      tabId: 1,
    }),
    false
  );
  // ...while tab 2's separate chat on the same site still prompts.
  assert.equal(
    needsToolPermission({
      sensitiveActionAlerts: true,
      origin: 'https://shop.example',
      toolName: 'checkout_cart',
      tabId: 2,
    }),
    true
  );

  // Resetting tab 2's chat leaves tab 1's grant intact.
  clearSessionToolPermissions(2);
  assert.equal(
    needsToolPermission({
      sensitiveActionAlerts: true,
      origin: 'https://shop.example',
      toolName: 'checkout_cart',
      tabId: 1,
    }),
    false
  );

  // Resetting tab 1's chat clears tab 1's grant.
  clearSessionToolPermissions(1);
  assert.equal(
    needsToolPermission({
      sensitiveActionAlerts: true,
      origin: 'https://shop.example',
      toolName: 'checkout_cart',
      tabId: 1,
    }),
    true
  );
});

/**
 * Runs the real `useAgentSession` once and hands back what it returned.
 *
 * There is no jsdom here, but a server render is enough for this: it executes
 * the hook body, so `useState`, `useRef` and `useCallback` all behave, and the
 * callbacks it closes over can be invoked afterwards. Effects do not run, which
 * suits us — nothing reaches for `chrome`. `fetch` is stubbed because resetting
 * a chat tells the backend about it, and restored however the test ends.
 */
function withAgentSession(run: (session: UseAgentSessionReturn) => void): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({}),
  })) as unknown as typeof fetch;

  let session: UseAgentSessionReturn | null = null;
  function Harness() {
    session = useAgentSession(1, { sensitiveActionAlerts: true, origin: 'https://shop.example' });
    return null;
  }

  try {
    renderToString(React.createElement(Harness));
    assert.ok(session, 'the hook should have run during the render');
    run(session!);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('starting a new chat forgets the tools granted in that tab only', () => {
  clearSessionToolPermissions();
  allowToolForSession('https://shop.example', 'checkout_cart', 1);
  allowToolForSession('https://other.example', 'send_message', 1);
  allowToolForSession('https://shop.example', 'checkout_cart', 2);

  // The hook is bound to tab 1.
  withAgentSession((session) => {
    session.handleReset();
  });

  // Permission was given for the conversation the user was having, not for
  // every one that follows it.
  assert.equal(isToolAllowedForSession('https://shop.example', 'checkout_cart', 1), false);
  assert.equal(isToolAllowedForSession('https://other.example', 'send_message', 1), false);
  // Another tab's chat keeps its own grants.
  assert.equal(isToolAllowedForSession('https://shop.example', 'checkout_cart', 2), true);
  // And the gate agrees, rather than just the bookkeeping.
  assert.equal(
    needsToolPermission({
      sensitiveActionAlerts: true,
      origin: 'https://shop.example',
      toolName: 'checkout_cart',
      tabId: 1,
    }),
    true
  );
});

