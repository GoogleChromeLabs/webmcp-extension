/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { tabSessions } from '../services/tabSessionStore.js';

interface GlobalWindowWithChrome {
  chrome?: typeof chrome;
}

function getChrome(): typeof chrome | undefined {
  const win = (typeof window !== 'undefined' ? window : undefined) as
    | (Window & GlobalWindowWithChrome)
    | undefined;
  return win?.chrome;
}

export interface UseActiveTabIdOptions {
  /** The backend in use, so a closed tab's conversation ends on the right one. */
  onDeviceModel?: boolean;
}

/**
 * The tab the side panel is looking at.
 *
 * The panel belongs to a window, not to a tab, so it has to follow the tab in
 * front itself: switching tabs has to change what the panel shows, the way
 * moving to another page does. Everything keyed by tab id hangs off this.
 *
 * Tabs that are closed are cleaned up here too, since this is the one place
 * the panel watches the tab strip from.
 */
export function useActiveTabId(options: UseActiveTabIdOptions = {}): number | null {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // Read by listeners that outlive the render which set it, so the listeners
  // do not have to be torn down and reinstalled when the backend changes.
  const onDeviceModelRef = useRef<boolean>(Boolean(options.onDeviceModel));
  useEffect(() => {
    onDeviceModelRef.current = Boolean(options.onDeviceModel);
  }, [options.onDeviceModel]);

  useEffect(() => {
    const chromeApi = getChrome();
    if (!chromeApi?.tabs) return;

    let cancelled = false;

    /**
     * Re-reads the tab in front of this window. Events fire for every window,
     * and the panel only cares about its own, so the answer comes from a query
     * scoped to this one rather than from the event's tab id.
     */
    const sync = async () => {
      try {
        const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        if (cancelled) return;
        setActiveTabId(tab?.id ?? null);
      } catch {
        // A window closing mid-query is not worth reporting.
      }
    };

    const onActivated = () => {
      void sync();
    };
    const onRemoved = (removedTabId: number) => {
      // The conversation cannot be reached again, so it is stopped and its
      // backend chat released rather than left holding context.
      tabSessions.remove(removedTabId, { onDevice: onDeviceModelRef.current });
      void sync();
    };
    const onReplaced = (_addedTabId: number, removedTabId: number) => {
      tabSessions.remove(removedTabId, { onDevice: onDeviceModelRef.current });
      void sync();
    };

    chromeApi.tabs.onActivated?.addListener(onActivated);
    chromeApi.tabs.onRemoved?.addListener(onRemoved);
    chromeApi.tabs.onReplaced?.addListener(onReplaced);
    chromeApi.windows?.onFocusChanged?.addListener(onActivated);

    void sync();

    return () => {
      cancelled = true;
      chromeApi.tabs.onActivated?.removeListener(onActivated);
      chromeApi.tabs.onRemoved?.removeListener(onRemoved);
      chromeApi.tabs.onReplaced?.removeListener(onReplaced);
      chromeApi.windows?.onFocusChanged?.removeListener(onActivated);
    };
  }, []);

  return activeTabId;
}

export default useActiveTabId;
