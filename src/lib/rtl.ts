/**
 * RTL handling for Arabic.
 *
 * Web applies the direction immediately; native React Native needs an app
 * reload after the switch, so callers show a hint when Platform.OS !== 'web'.
 */

import { Platform } from 'react-native';

import type { AppLanguage } from '@/store/settings';

export function applyRTL(language: AppLanguage): void {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = language;
    }
    return;
  }
  // Native: forceRTL only takes full effect after an app restart, but
  // calling it persists the choice for the next launch.
  const { I18nManager } = require('react-native');
  if (I18nManager) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(language === 'ar');
  }
}

/** True when a language change needs an app restart to fully apply. */
export function rtlNeedsRestart(): boolean {
  return Platform.OS !== 'web';
}
