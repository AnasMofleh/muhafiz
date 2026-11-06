import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Amiri: require('../../assets/fonts/Amiri-Regular.ttf'),
    'Amiri-Bold': require('../../assets/fonts/Amiri-Bold.ttf'),
    ScheherazadeNew: require('../../assets/fonts/ScheherazadeNew-Regular.ttf'),
    'ScheherazadeNew-Bold': require('../../assets/fonts/ScheherazadeNew-Bold.ttf'),
  });

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {fontsLoaded && (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="surah/[id]" />
          <Stack.Screen name="settings" />
        </Stack>
      )}
    </ThemeProvider>
  );
}
