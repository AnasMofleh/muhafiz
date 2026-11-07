import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MushafText } from '@/components/mushaf-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  buildGradingResult,
  parseGradingRequest,
  type GradingRequest,
} from '@/lib/grading-links';
import { shareText, waLink } from '@/lib/share';
import { useSettings } from '@/store/settings';
import type { Rating } from '@/lib/scheduler';

const RATINGS: { rating: Rating; label: string; short: string }[] = [
  { rating: 1, label: 'Again', short: '1' },
  { rating: 2, label: 'Hard', short: '2' },
  { rating: 3, label: 'Good', short: '3' },
  { rating: 4, label: 'Easy', short: '4' },
];

export default function GradeScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();
  const { p } = useLocalSearchParams<{ p?: string }>();
  const { fontScale, mushafTextColor, mushafParchment } = useSettings();

  const [paste, setPaste] = useState('');
  const [request, setRequest] = useState<GradingRequest | null>(null);
  const [surah, setSurah] = useState<SurahData | null>(null);
  const [ratings, setRatings] = useState<Record<number, Rating>>({});
  const [resultText, setResultText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadRequest = (raw: string) => {
    const parsed = parseGradingRequest(raw);
    if (!parsed) {
      setError(t('grade.invalid'));
      return;
    }
    setRequest(parsed);
    setRatings({});
    setResultText(null);
    setError(null);
  };

  useEffect(() => {
    if (p) loadRequest(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  useEffect(() => {
    if (!request) {
      setSurah(null);
      return;
    }
    let cancelled = false;
    getSurah(request.surah).then((data) => {
      if (!cancelled) setSurah(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const ayahs = useMemo(() => {
    if (!surah || !request) return [];
    return surah.ayahs.filter(
      (a) => a.number >= request.fromAyah && a.number <= request.toAyah
    );
  }, [surah, request]);

  const buildResult = () => {
    if (!request) return;
    const text = buildGradingResult(request, ratings);
    setResultText(text);
  };

  const handleShare = async (text: string) => {
    const result = await shareText(text);
    if (result.message) setFeedback(result.message);
  };

  const handleWhatsApp = async (text: string) => {
    try {
      await Linking.openURL(waLink(text));
    } catch {
      await handleShare(text);
    }
  };

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
          <ThemedText style={styles.title}>{t('grade.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!request ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.pasteLabel} themeColor="textSecondary">
                {t('grade.pasteRequest')}
              </ThemedText>
              <TextInput
                value={paste}
                onChangeText={setPaste}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                placeholder="GR:…"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.pasteInput,
                  {
                    backgroundColor: theme.background,
                    color: theme.text,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
                testID="grade-paste-input"
              />
              <Pressable
                onPress={() => loadRequest(paste.trim())}
                style={[styles.primaryBtn, { backgroundColor: Brand.emerald }]}
                accessibilityRole="button"
                accessibilityLabel={t('grade.applyBtn')}
                testID="grade-load">
                <ThemedText style={styles.primaryBtnText}>{t('grade.applyBtn')}</ThemedText>
              </Pressable>
              {error ? (
                <ThemedText type="small" style={styles.errorText}>
                  {error}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <>
              <ThemedText style={styles.hint} themeColor="textSecondary">
                {t('grade.hint')}
              </ThemedText>
              {surah ? (
                <MushafText
                  surah={surah}
                  fromAyah={request.fromAyah}
                  toAyah={request.toAyah}
                  layout="flow"
                  textColor={mushafTextColor}
                  parchment={mushafParchment}
                  fontScale={fontScale}
                />
              ) : (
                <ThemedText themeColor="textSecondary">{t('common.loading')}</ThemedText>
              )}

              {ayahs.map((ayah) => (
                <View
                  key={ayah.number}
                  style={[styles.ayahGradeRow, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.ayahGradeLabel} type="smallBold">
                    {t('grade.ayahLabel', { n: ayah.number })}
                  </ThemedText>
                  <View style={styles.ratingRow}>
                    {RATINGS.map(({ rating, label }) => {
                      const selected = ratings[ayah.number] === rating;
                      return (
                        <Pressable
                          key={rating}
                          onPress={() =>
                            setRatings((previous) => ({ ...previous, [ayah.number]: rating }))
                          }
                          style={[
                            styles.ratingBtn,
                            {
                              borderColor: selected ? Brand.emerald : theme.backgroundSelected,
                              backgroundColor: selected ? Brand.emerald : 'transparent',
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('grade.ayahLabel', { n: ayah.number })}: ${label}`}
                          accessibilityState={{ selected }}
                          testID={`grade-ayah-${ayah.number}-${rating}`}>
                          <ThemedText
                            type="smallBold"
                            style={{ color: selected ? '#fff' : theme.text }}>
                            {label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              <Pressable
                onPress={buildResult}
                style={[styles.primaryBtn, { backgroundColor: Brand.goldDark }]}
                accessibilityRole="button"
                accessibilityLabel={t('grade.buildResult')}
                testID="grade-build-result">
                <Ionicons name="link-outline" size={18} color="#fff" />
                <ThemedText style={styles.primaryBtnText}>{t('grade.buildResult')}</ThemedText>
              </Pressable>

              {resultText ? (
                <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t('grade.resultReady')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.resultText}>
                    {resultText}
                  </ThemedText>
                  <View style={styles.resultActions}>
                    <Pressable
                      onPress={() => void handleShare(resultText)}
                      style={[styles.secondaryBtn, { borderColor: theme.backgroundSelected }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('grade.copyResult')}
                      testID="grade-copy-result">
                      <Ionicons name="copy-outline" size={16} color={theme.text} />
                      <ThemedText type="smallBold">{t('grade.copyResult')}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleWhatsApp(resultText)}
                      style={[styles.secondaryBtn, { borderColor: theme.backgroundSelected }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('grade.shareResult')}
                      testID="grade-share-wa">
                      <Ionicons name="logo-whatsapp" size={16} color={Brand.emerald} />
                      <ThemedText type="smallBold">{t('grade.shareResult')}</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {feedback ? (
                <ThemedText type="small" style={{ color: Brand.emerald }}>
                  {feedback}
                </ThemedText>
              ) : null}
            </>
          )}
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
  body: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  hint: { fontSize: 13, textAlign: 'center' },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  pasteLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  pasteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: 700 },
  errorText: { color: '#B3261E' },
  ayahGradeRow: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  ayahGradeLabel: { fontSize: 13 },
  ratingRow: { flexDirection: 'row', gap: Spacing.two },
  ratingBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two,
  },
  resultText: { fontSize: 12, lineHeight: 17 },
  resultActions: { flexDirection: 'row', gap: Spacing.two },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two,
  },
});
