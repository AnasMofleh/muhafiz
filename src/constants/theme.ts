/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

/** Semantic status colors shared across practice modes (theme-independent). */
export const Semantic = {
  danger: '#B3261E',
  dangerSoft: '#FDECEA',
  warning: '#C9A227',
  warningDark: '#7A5F10',
  success: '#0E7A5F',
  successBright: '#43D6A3', // readable on dark backgrounds
} as const;

/**
 * Brand palette — deep emerald (Islamic green) + gold, plus the mushaf
 * ayah highlight used across all practice modes.
 */
export const Brand = {
  emerald: '#0E7A5F',
  emeraldSoft: '#E3F2EE',
  emeraldDark: '#0A5C47',
  gold: '#C9A227',
  /** darker gold for light-mode text/borders (contrast ≥ 4.5:1) */
  goldDark: '#7A5F10',
  goldSoft: '#F7EFD8',
  ayahHighlight: '#F2E8C9', // parchment tone behind the active ayah
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
