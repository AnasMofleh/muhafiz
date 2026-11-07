import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MushafText } from '@/components/mushaf-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { ensureDb, recordActivity, localDateKey } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { useSettings } from '@/store/settings';

/**
 * Hide & Recite — read the surah as it appears in the mushaf (continuous
 * flow), with the NEXT ayah hidden until you tap it. No grading, no cards:
 * this is pure practice; it only keeps the daily streak alive.
 */
export default function HideAyahScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();
  const { mushafTextColor, mushafParchment, fontScale, flashcardSurah } = useSettings();

  const [surah, setSurah] = useState<SurahData | null>(null);
  const [current, setCurrent] = useState(1);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSurah(null);
    setCurrent(1);
    setRevealed(false);
    getSurah(flashcardSurah)
      .then((data) => {
        if (cancelled) return;
        if (data) setSurah(data);
        else setError(t('mushaf.surahNotFound'));
      })
      .catch(() => {
        if (!cancelled) setError(t('mushaf.surahNotFound'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashcardSurah]);

  const reveal = () => {
    if (revealed) return;
    setRevealed(true);
    // A revealed ayah counts as practice — keeps the streak alive.
    ensureDb()
      .then(() => recordActivity(localDateKey()))
      .catch(() => {});
  };

  const next = () => {
    if (!surah) return;
    if (current >= surah.ayahCount) {
      setCurrent(1);
    } else {
      setCurrent(current + 1);
    }
    setRevealed(false);
  };

  // The ayah being recited is visible; the NEXT one stays hidden until tap.
  const hidden = new Set<number>();
  if (surah && current + 1 <= surah.ayahCount && !revealed) hidden.add(current + 1);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.title}>{t('hideAyah.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        <ThemedText style={styles.hint} themeColor="textSecondary">
          {t('hideAyah.hint')}
        </ThemedText>

        {error ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
          </View>
        ) : surah ? (
          <>
            <ScrollView contentContainerStyle={styles.body}>
              <MushafText
                surah={surah}
                layout="flow"
                textColor={mushafTextColor}
                parchment={mushafParchment}
                fontScale={fontScale}
                currentAyah={current}
                hiddenAyahs={hidden}
                onAyahTap={(ayahNumber) => {
                  if (hidden.has(ayahNumber)) reveal();
                }}
                testIDPrefix="hide-ayah"
              />

              <ThemedText style={styles.progress} themeColor="textSecondary">
                {t('hideAyah.progress', { current, total: surah.ayahCount })}
              </ThemedText>
            </ScrollView>

            <View style={styles.actions}>
              {!revealed && current + 1 <= surah.ayahCount ? (
                <Pressable
                  onPress={reveal}
                  style={[styles.primaryBtn, { backgroundColor: Brand.emerald }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('hideAyah.tapToReveal')}
                  testID="hide-reveal">
                  <Ionicons name="eye-outline" size={20} color="#fff" />
                  <ThemedText style={styles.primaryBtnText}>{t('hideAyah.tapToReveal')}</ThemedText>
                </Pressable>
              ) : (
                <Pressable
                  onPress={next}
                  style={[styles.primaryBtn, { backgroundColor: isDark ? Brand.teal : Brand.teal }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.next')}
                  testID="hide-next">
                  <ThemedText style={styles.primaryBtnText}>{t('common.next')}</ThemedText>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </Pressable>
              )}
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">{t('common.loading')}</ThemedText>
          </View>
        )}
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
  hint: { fontSize: 13, textAlign: 'center', paddingHorizontal: Spacing.four, marginBottom: Spacing.two },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  progress: { textAlign: 'center', marginTop: Spacing.two },
  actions: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingVertical: Spacing.three,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 700 },
});
