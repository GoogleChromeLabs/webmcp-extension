/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, Dispatch, SetStateAction } from 'react';

/**
 * Hook for managing application theme. Enforces light mode only.
 */
export function useTheme(): [string, Dispatch<SetStateAction<string>>] {
  const [theme, setTheme] = useState<string>('light');

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    localStorage.theme = 'light';
  }, [theme]);

  return [theme, setTheme];
}
