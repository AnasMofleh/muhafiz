import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useSettings } from '@/store/settings';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * The user's theme setting overrides the OS scheme (see use-color-scheme.ts).
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);
  const theme = useSettings((state) => state.theme);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (!hasHydrated) return 'light';
  if (theme === 'light' || theme === 'dark') return theme;
  return colorScheme === 'dark' ? 'dark' : 'light';
}
