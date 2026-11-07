import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { checkBadges, describeBadges, getBadgeState } from '@/lib/badges';
import {
  gradeCardReview,
  loadDefaultQueue,
  loadTodaySession,
  sessionSummary,
  type CardRow,
  type Rating,
} from '@/lib/modes';
import { useAyahAudio } from '@/lib/use-ayah-audio';
import { useSettings } from '@/store/settings';

const GRADE_BUTTONS: { rating: Rating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export default function HideAyahScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { session } = useLocalSearchParams<{ session?: string }>();
  const fontScale = useSettings((state) => state.fontScale);
  const { playAyah, playing } = useAyahAudio();

  const [cards, setCards] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [surah, setSurah] = useState<SurahData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [cardsDone, setCardsDone] = useState(0);
  const [finished, setFinished] = useState(false);
  const [newBadges, setNewBadges] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded =
          session === 'today'
            ? (await loadTodaySession(20)).cards
            : await loadDefaultQueue(10);
        if (active) {
          setCards(loaded);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load cards.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session]);

  const card = cards[index] ?? null;
  const cardSurah = card?.surah ?? 0;
  const cardKey = card?.unitKey ?? '';

  useEffect(() => {
    let active = true;
    setSurah(null);
    if (cardSurah <= 0) {
      return () => {
        active = false;
      };
    }
    getSurah(cardSurah)
      .then((data) => {
        if (active) setSurah(data ?? null);
      })
      .catch(() => {
        if (active) setSurah(null);
      });
    return () => {
      active = false;
    };
  }, [cardSurah, cardKey]);

  const currentAyahText =
    card && surah ? surah.ayahs[card.startAyah - 1]?.text_uthmani ?? '' : '';
  const hasNextAyah = Boolean(card) && Boolean(surah) && Boolean(card && card.endAyah > card.startAyah);
  const nextAyahText =
    card && surah && hasNextAyah
      ? surah.ayahs[card.startAyah]?.text_uthmani ?? ''
      : '';

  const handleGrade = useCallback(
    async (rating: Rating) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const result = await gradeCardReview({ card, rating, mode: 'hide-ayah' });
        setCards((previous) =>
          previous.map((item) => (item.unitKey === result.card.unitKey ? result.card : item))
        );
        const nextXp = sessionXp + result.xp;
        setSessionXp(nextXp);
        const done = index + 1;
        setCardsDone(done);
        if (done >= cards.length) {
          setFinished(true);
          try {
            setNewBadges(await checkBadges(await getBadgeState()));
          } catch {
            setNewBadges([]);
          }
        } else {
          setIndex(done);
          setRevealed(false);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save this review.');
      } finally {
        setBusy(false);
      }
    },
    [busy, card, cards.length, index, sessionXp]
  );

  const restart = useCallback(() => {
    setIndex(0);
    setRevealed(false);
    setSessionXp(0);
    setCardsDone(0);
    setFinished(false);
    setNewBadges([]);
    setError(null);
  }, []);

  const gradeColor = (rating: Rating): string => {
    if (rating === 1) return isDark ? '#B03A2E' : '#C0392B';
    if (rating === 2) return isDark ? '#C98A1B' : '#B7791F';
    if (rating === 3) return Brand.emerald;
    return isDark ? '#0F6B54' : Brand.emeraldDark;
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="hide-back">
        <Ionicons name="arrow-back" size={22} color={theme.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>Hide &amp; Recite</ThemedText>
      <View style={[styles.progressPill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.progressText}>
          {cards.length > 0 ? `${Math.min(index + 1, cards.length)}/${cards.length}` : '0/0'}
        </ThemedText>
      </View>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.center}>
          <ActivityIndicator size="large" color={Brand.emerald} />
          <ThemedText themeColor="textSecondary" style={styles.loadingText}>
            Loading cards…
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (cards.length === 0) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          <View style={styles.center}>
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
              ]}>
              <Ionicons
                name="eye-off-outline"
                size={30}
                color={isDark ? '#fff' : Brand.emeraldDark}
              />
            </View>
            <ThemedText style={styles.emptyTitle}>Nothing to practice yet</ThemedText>
            <ThemedText style={styles.emptyBody} themeColor="textSecondary">
              Complete your first lesson — create a plan on the Today screen
            </ThemedText>
            <Pressable
              onPress={() => router.push('/')}
              style={[styles.primaryBtn, { backgroundColor: Brand.emerald }]}
              accessibilityRole="button"
              accessibilityLabel="Open the Today screen"
              testID="hide-open-today">
              <ThemedText style={styles.primaryBtnText}>Open Today</ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (finished) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          <ScrollView contentContainerStyle={styles.summaryBody}>
            <View
              style={[
                styles.trophy,
                { backgroundColor: isDark ? '#3A2F0B' : Brand.goldSoft },
              ]}>
              <Ionicons name="trophy" size={40} color={isDark ? Brand.gold : Brand.goldDark} />
            </View>
            <ThemedText style={styles.summaryTitle}>Session complete</ThemedText>
            <ThemedText style={styles.summaryLine} themeColor="textSecondary">
              {sessionSummary(cardsDone, sessionXp)}
            </ThemedText>
            {newBadges.length > 0 ? (
              <View style={[styles.badgeCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.badgeTitle}>New badge unlocked</ThemedText>
                <ThemedText style={styles.badgeLine}>{describeBadges(newBadges)}</ThemedText>
              </View>
            ) : null}
            <Pressable
              onPress={restart}
              style={[styles.primaryBtn, { backgroundColor: Brand.emerald, width: '100%' }]}
              accessibilityRole="button"
              accessibilityLabel="Practice these cards again"
              testID="hide-again">
              <Ionicons name="refresh" size={18} color="#fff" />
              <ThemedText style={styles.primaryBtnText}>Another round</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={[styles.secondaryBtn, { borderColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Done practicing"
              testID="hide-done">
              <ThemedText>Done</ThemedText>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {header}

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={[styles.errorCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.errorText} themeColor="textSecondary">
                {error}
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.cardMetaRow}>
              <ThemedText style={styles.cardMeta} themeColor="textSecondary">
                {card ? `${card.surah}:${card.startAyah}` : ''}
                {surah ? ` · ${surah.englishName}` : ''}
              </ThemedText>
              <Pressable
                onPress={() => {
                  if (card) playAyah(card.surah, card.startAyah);
                }}
                style={[
                  styles.playBtn,
                  { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Play this ayah"
                accessibilityState={{ busy: playing }}
                testID="hide-play">
                <Ionicons
                  name={playing ? 'volume-high' : 'play'}
                  size={16}
                  color={isDark ? '#fff' : Brand.emeraldDark}
                />
                <ThemedText
                  style={[styles.playText, { color: isDark ? '#fff' : Brand.emeraldDark }]}>
                  {playing ? 'Playing' : 'Listen'}
                </ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.ayahLabel}>AYAH {card?.startAyah ?? ''}</ThemedText>
            <ThemedText
              style={[
                styles.arabic,
                { fontSize: 24 * fontScale, lineHeight: 42 * fontScale },
              ]}>
              {currentAyahText}
            </ThemedText>

            {hasNextAyah ? (
              <View
                style={[styles.hiddenBlock, { borderColor: theme.backgroundSelected }]}
                accessibilityElementsHidden={!revealed}
                importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}>
                <View style={styles.hiddenHeader}>
                  <Ionicons
                    name={revealed ? 'eye-outline' : 'eye-off-outline'}
                    size={14}
                    color={theme.textSecondary}
                  />
                  <ThemedText style={styles.hiddenLabel} themeColor="textSecondary">
                    {revealed ? `Ayah ${card ? card.startAyah + 1 : ''}` : 'Next ayah — recite it from memory'}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[
                    styles.arabic,
                    {
                      fontSize: 24 * fontScale,
                      lineHeight: 42 * fontScale,
                      opacity: revealed ? 1 : 0.08,
                    },
                  ]}>
                  {nextAyahText}
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.singleAyahNote, { borderColor: theme.backgroundSelected }]}>
                <ThemedText style={styles.hiddenLabel} themeColor="textSecondary">
                  This chunk is a single ayah. Recite it, then reveal and grade yourself.
                </ThemedText>
              </View>
            )}
          </View>

          {!revealed ? (
            <View style={styles.actions}>
              <Pressable
                onPress={() => setRevealed(true)}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: Brand.emerald },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="I recited it, reveal the ayah"
                testID="hide-reveal">
                <Ionicons name="eye-outline" size={18} color="#fff" />
                <ThemedText style={styles.primaryBtnText}>I recited it</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void handleGrade(1)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { borderColor: isDark ? '#B03A2E' : '#C0392B' },
                  (pressed || busy) && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Couldn't recall, grade Again"
                accessibilityState={{ disabled: busy }}
                testID="hide-couldnt">
                <ThemedText style={{ color: isDark ? '#F28B82' : '#C0392B', fontWeight: 700 }}>
                  Couldn&apos;t recall
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.gradeSection}>
              <ThemedText style={styles.gradePrompt} themeColor="textSecondary">
                How well did you recite it?
              </ThemedText>
              <View style={styles.gradeRow}>
                {GRADE_BUTTONS.map(({ rating, label }) => (
                  <Pressable
                    key={rating}
                    onPress={() => void handleGrade(rating)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.gradeBtn,
                      { backgroundColor: gradeColor(rating) },
                      (pressed || busy) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Grade ${label}`}
                    accessibilityState={{ disabled: busy }}
                    testID={`hide-grade-${rating}`}>
                    <ThemedText style={styles.gradeBtnText}>{label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: Brand.emerald,
                  width: `${(index / Math.max(1, cards.length)) * 100}%`,
                },
              ]}
            />
          </View>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: 700, textAlign: 'center' },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  progressPill: {
    minWidth: 38,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
  },
  progressText: { fontSize: 13, fontWeight: 700 },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  errorCard: { borderRadius: 12, padding: Spacing.three },
  errorText: { fontSize: 12 },
  card: { borderRadius: 22, padding: Spacing.four, gap: Spacing.three, marginTop: Spacing.two },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardMeta: { fontSize: 12, fontWeight: 700, letterSpacing: 0.4, flex: 1 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
  playText: { fontSize: 12, fontWeight: 700 },
  ayahLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1.2 },
  arabic: { fontFamily: 'Amiri', textAlign: 'right', writingDirection: 'rtl' },
  hiddenBlock: {
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  hiddenHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  hiddenLabel: { fontSize: 11, fontWeight: 600 },
  singleAyahNote: {
    borderTopWidth: 1,
    paddingTop: Spacing.three,
  },
  actions: { gap: Spacing.two, marginTop: Spacing.one },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 700 },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    width: '100%',
  },
  pressed: { opacity: 0.75 },
  gradeSection: { gap: Spacing.two, marginTop: Spacing.one },
  gradePrompt: { fontSize: 12, fontWeight: 600, textAlign: 'center' },
  gradeRow: { flexDirection: 'row', gap: 6 },
  gradeBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  gradeBtnText: { color: '#fff', fontSize: 13, fontWeight: 700 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: Spacing.three,
    backgroundColor: 'transparent',
  },
  progressFill: { height: 6, borderRadius: 3 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  loadingText: { fontSize: 13 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  emptyTitle: { fontSize: 20, fontWeight: 700, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320 },
  summaryBody: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  trophy: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  summaryTitle: { fontSize: 24, fontWeight: 700, marginTop: Spacing.two },
  summaryLine: { fontSize: 14, textAlign: 'center' },
  badgeCard: {
    borderRadius: 14,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
    width: '100%',
    marginTop: Spacing.two,
  },
  badgeTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 0.4 },
  badgeLine: { fontSize: 14, fontWeight: 600, textAlign: 'center' },
});
