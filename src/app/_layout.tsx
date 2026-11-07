import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useLayoutEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { applyRTL } from '@/lib/rtl';
import { useSettings } from '@/store/settings';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const language = useSettings((state) => state.language);
  const [fontsLoaded, fontError] = useFonts({
    Amiri: require('../../assets/fonts/Amiri-Regular.ttf'),
    'Amiri-Bold': require('../../assets/fonts/Amiri-Bold.ttf'),
    ScheherazadeNew: require('../../assets/fonts/ScheherazadeNew-Regular.ttf'),
    'ScheherazadeNew-Bold': require('../../assets/fonts/ScheherazadeNew-Bold.ttf'),
  });

  // Apply RTL whenever the language changes (web is instant; native applies
  // after restart).
  useLayoutEffect(() => {
    applyRTL(language);
  }, [language]);

  if (fontError) {
    // Fall back to system Arabic fonts instead of a permanently blank app.
    console.warn('Muhafiz: font loading failed, using system fonts', fontError);
  }

  // Render when fonts are ready OR when they failed (system-font fallback).
  const ready = fontsLoaded || Boolean(fontError);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {ready && (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="surah/[id]" />
          <Stack.Screen name="settings" />
        </Stack>
      )}
    </ThemeProvider>
  );
}
