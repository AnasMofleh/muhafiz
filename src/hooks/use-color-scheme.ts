import { useColorScheme as useRNColorScheme } from 'react-native';

import { useSettings } from '@/store/settings';

/**
 * Effective color scheme: the user's theme setting overrides the OS scheme,
 * so "System / Light (white) / Dark" works across every screen that uses
 * this hook (all of them — it's the single source of truth).
 */
export function useColorScheme(): 'light' | 'dark' {
  const theme = useSettings((state) => state.theme);
  const system = useRNColorScheme();
  if (theme === 'light' || theme === 'dark') return theme;
  return system === 'dark' ? 'dark' : 'light';
}
