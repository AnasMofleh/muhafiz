import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { getReciter, PLAYBACK_RATES, RECITERS, REPEAT_OPTIONS } from '@/lib/reciters';
import { useSettings } from '@/store/settings';

export default function SettingsScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const settings = useSettings();

  // Selected-chip colors that stay readable in both themes.
  const chipBg = isDark ? Brand.emeraldDark : Brand.emeraldSoft;
  const chipText = isDark ? '#ffffff' : Brand.emeraldDark;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.title}>Settings</ThemedText>
          <View style={styles.headerRight} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            RECITER
          </ThemedText>
          {RECITERS.map((r) => {
            const selected = r.id === settings.reciterId;
            return (
              <Pressable
                key={r.id}
                onPress={() => settings.setReciter(r.id)}
                style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText style={styles.rowName}>{r.name}</ThemedText>
                  {r.note ? (
                    <ThemedText style={styles.rowNote} themeColor="textSecondary">
                      {r.note}
                    </ThemedText>
                  ) : null}
                </View>
                {selected && <Ionicons name="checkmark-circle" size={22} color={Brand.emerald} />}
              </Pressable>
            );
          })}

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            PLAYBACK SPEED
          </ThemedText>
          <View style={styles.optionRow}>
            {PLAYBACK_RATES.map((rate) => (
              <Pressable
                key={rate}
                onPress={() => settings.setPlaybackRate(rate)}
                style={[
                  styles.option,
                  {
                    borderColor: rate === settings.playbackRate ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: rate === settings.playbackRate ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, rate === settings.playbackRate && { color: chipText }]}>
                  {rate}×
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            REPEAT EACH AYAH
          </ThemedText>
          <View style={styles.optionRow}>
            {REPEAT_OPTIONS.map((n) => (
              <Pressable
                key={n}
                onPress={() => settings.setRepeatAyah(n)}
                style={[
                  styles.option,
                  {
                    borderColor: n === settings.repeatAyah ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: n === settings.repeatAyah ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, n === settings.repeatAyah && { color: chipText }]}>
                  ×{n}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            MUSHAF TEXT SIZE
          </ThemedText>
          <View style={styles.optionRow}>
            {[0.85, 1, 1.15].map((scale) => (
              <Pressable
                key={scale}
                onPress={() => settings.setFontScale(scale)}
                style={[
                  styles.option,
                  {
                    borderColor: scale === settings.fontScale ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: scale === settings.fontScale ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, scale === settings.fontScale && { color: chipText }]}>
                  {scale === 0.85 ? 'A−' : scale === 1.15 ? 'A+' : 'A'}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            LISTENING
          </ThemedText>
          <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowText}>
              <ThemedText style={styles.rowName}>Auto-advance to next ayah</ThemedText>
              <ThemedText style={styles.rowNote} themeColor="textSecondary">
                Continue playing through the surah
              </ThemedText>
            </View>
            <Switch
              value={settings.autoAdvance}
              onValueChange={settings.setAutoAdvance}
              trackColor={{ true: Brand.emerald }}
            />
          </View>

          <ThemedText style={styles.credits} themeColor="textSecondary">
            Quran text (Hafs, Uthmani) © Tanzil Project · Audio streamed from everyayah.com · Fonts: Amiri (OFL),
            Scheherazade New (SIL OFL)
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: 700, flex: 1, textAlign: 'center' },
  headerRight: { width: 38 },
  body: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  sectionTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 1, marginTop: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: 600 },
  rowNote: { fontSize: 12, marginTop: 1 },
  optionRow: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  optionText: { fontSize: 14, fontWeight: 600 },
  credits: { fontSize: 11, lineHeight: 16, marginTop: Spacing.five, textAlign: 'center' },
});
