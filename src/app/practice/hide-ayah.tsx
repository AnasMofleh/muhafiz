import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
 * flow) with EVERYTHING after the current ayah fully hidden. Each tap
 * reveals only the next ayah. No grading; keeps the daily streak alive.
 * Start-ayah + surah controls live behind the gear in the corner.
 */
export default function HideAyahScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();
  const { mushafTextColor, mushafParchment, fontScale, flashcardSurah, setFlashcardSurah } =
    useSettings();

  const [surah, setSurah] = useState<SurahData | null>(null);
  const [startAyah, setStartAyah] = useState(1);
  const [current, setCurrent] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSurah(null);
    setStartAyah(1);
    setCurrent(1);
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

  const applyStartAyah = (ayah: number) => {
    setStartAyah(ayah);
    setCurrent(ayah);
    setPanelOpen(false);
  };

  const reveal = () => {
    if (!surah || current >= surah.ayahCount) return;
    setCurrent(current + 1);
    // A revealed ayah counts as practice — keeps the streak alive.
    ensureDb()
      .then(() => recordActivity(localDateKey()))
      .catch(() => {});
  };

  const next = () => {
    if (!surah) return;
    if (current >= surah.ayahCount) {
      setCurrent(startAyah);
    } else {
      setCurrent(current + 1);
    }
  };

  // Everything AFTER the current ayah is fully hidden; a tap reveals only
  // the next one.
  const hidden = new Set<number>();
  if (surah) {
    for (let ayah = current + 1; ayah <= surah.ayahCount; ayah += 1) hidden.add(ayah);
  }

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
          <Pressable
            onPress={() => setPanelOpen(true)}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.settings')}
            testID="hide-ayah-settings">
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
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
                fromAyah={startAyah}
                layout="flow"
                textColor={mushafTextColor}
                parchment={mushafParchment}
                fontScale={fontScale}
                currentAyah={current}
                hiddenAyahs={hidden}
                onAyahTap={() => {
                  // Tapping the hidden area reveals only the next ayah.
                  reveal();
                }}
                testIDPrefix="hide-ayah"
              />

              <ThemedText style={styles.progress} themeColor="textSecondary">
                {t('hideAyah.progress', { current, total: surah.ayahCount })}
              </ThemedText>
            </ScrollView>

            <View style={styles.actions}>
              {current < surah.ayahCount ? (
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
                  style={[styles.primaryBtn, { backgroundColor: Brand.teal }]}
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

        {/* Settings panel: start ayah + surah */}
        <Modal
          visible={panelOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPanelOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {t('common.settings')}
              </ThemedText>
              <ThemedText style={styles.modalLabel} themeColor="textSecondary">
                {t('common.surah')}
              </ThemedText>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setFlashcardSurah(Math.max(1, flashcardSurah - 1))}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous surah">
                  <Ionicons name="remove" size={18} color={theme.text} />
                </Pressable>
                <ThemedText type="smallBold">
                  {t('common.surah')} {flashcardSurah}
                </ThemedText>
                <Pressable
                  onPress={() => setFlashcardSurah(Math.min(114, flashcardSurah + 1))}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  accessibilityRole="button"
                  accessibilityLabel="Next surah">
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
              <ThemedText style={styles.modalLabel} themeColor="textSecondary">
                {t('recite.startAyah')}
              </ThemedText>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => applyStartAyah(Math.max(1, startAyah - 1))}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous ayah">
                  <Ionicons name="remove" size={18} color={theme.text} />
                </Pressable>
                <ThemedText type="smallBold" testID="hide-start-value">
                  {t('common.ayah')} {startAyah}
                </ThemedText>
                <Pressable
                  onPress={() => applyStartAyah(Math.min(surah?.ayahCount ?? 1, startAyah + 1))}
                  style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                  accessibilityRole="button"
                  accessibilityLabel="Next ayah">
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
              <Pressable
                onPress={() => setPanelOpen(false)}
                style={[styles.closeBtn, { backgroundColor: Brand.emerald }]}
                accessibilityRole="button"
                accessibilityLabel={t('common.done')}>
                <ThemedText style={styles.primaryBtnText}>{t('common.done')}</ThemedText>
              </Pressable>
            </View>
          </View>
        </Modal>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: { borderRadius: 18, padding: Spacing.four, gap: Spacing.three },
  modalTitle: { fontSize: 24, lineHeight: 30 },
  modalLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, marginTop: Spacing.two },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});
