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
    backgroundElement: '#f8f9fa',
    backgroundSelected: '#e9ecef',
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
  warning: '#C19A42',
  warningDark: '#8A6A12',
  success: '#196F15',
  successBright: '#43D6A3', // readable on dark backgrounds
} as const;

/**
 * Brand palette — the Alsalam color template: mosque green (#196F15),
 * teal-navy (#15546F), gold (#F1C152 / #C19A42) on white.
 */
export const Brand = {
  emerald: '#196F15',
  emeraldSoft: '#E6F0E6',
  emeraldDark: '#0F4A0C',
  teal: '#15546F',
  tealSoft: '#E3EDF2',
  gold: '#F1C152',
  /** deeper gold for light-mode text/borders (contrast ≥ 4.5:1) */
  goldDark: '#8A6A12',
  goldSoft: '#FBF3DD',
  ayahHighlight: '#F5EFD8', // parchment tone behind the active ayah
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
