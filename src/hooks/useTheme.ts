/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, Dispatch, SetStateAction } from 'react';

/**
 * Hook for managing application theme and syncing with DOM / system preferences.
 */
export function useTheme(): [string, Dispatch<SetStateAction<string>>] {
  const [theme, setTheme] = useState<string>(() => localStorage.theme || 'system');

  useEffect(() => {
    const applyThemeToDOM = (t: string) => {
      const isDark =
        t === 'dark' ||
        (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    };

    applyThemeToDOM(theme);
    localStorage.theme = theme;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') applyThemeToDOM('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return [theme, setTheme];
}
