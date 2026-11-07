import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getIndex, globalAyahNumber, juzStartGlobal } from '@/data/quran';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  ensureDb,
  getActivePlan,
  getAllCards,
  getProgress,
  getReviewLogsSince,
  type CardRow,
  type PlanRow,
  type ReviewLogRow,
  type SurahProgress,
} from '@/lib/db';
import { getGoalAyahCount, getPlanSurahs } from '@/lib/scheduler';

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_DAYS = 14;

type MilestoneState = 'none' | 'partial' | 'full';

interface Milestone {
  juz: number;
  state: MilestoneState;
}

function goalLabel(plan: PlanRow): string {
  if (plan.kind === 'quran') return 'The whole Quran';
  if (plan.kind === 'juz') {
    return plan.juzFrom === plan.juzTo ? `Juz ${plan.juzFrom}` : `Juz ${plan.juzFrom}–${plan.juzTo}`;
  }
  const count = plan.surahs.length;
  return `${count} ${count === 1 ? 'surah' : 'surahs'}`;
}

export default function PathScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();
  const index = getIndex();
  const accent = isDark ? '#43D6A3' : Brand.emerald;

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [logs, setLogs] = useState<ReviewLogRow[]>([]);
  const [progress, setProgress] = useState<SurahProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureDb();
      const active = await getActivePlan();
      if (!active) {
        setPlan(null);
        setCards([]);
        setLogs([]);
        setProgress([]);
        setError(null);
        return;
      }
      const surahs = getPlanSurahs(active);
      const [allCards, recentLogs] = await Promise.all([
        getAllCards(),
        getReviewLogsSince(Date.now() - FORECAST_DAYS * DAY_MS),
      ]);
      setPlan(active);
      setCards(allCards);
      setLogs(recentLogs);
      // Per-surah progress derived in memory from the loaded cards (one pass,
      // no per-surah queries).
      const progressList: SurahProgress[] = [];
      for (const meta of index.surahs) {
        const surahCards = allCards.filter((card) => card.surah === meta.number);
        const masteredCards = surahCards.filter((card) => card.status === 'mastered');
        const covered = new Array<boolean>(meta.ayahCount).fill(false);
        for (const card of masteredCards) {
          const from = Math.max(1, card.startAyah);
          const to = Math.min(meta.ayahCount, card.endAyah);
          for (let ayah = from; ayah <= to; ayah += 1) covered[ayah - 1] = true;
        }
        const masteredAyahs = covered.filter(Boolean).length;
        progressList.push({
          surah: meta.number,
          ayahCount: meta.ayahCount,
          masteredAyahs,
          totalCards: surahCards.length,
          masteredCards: masteredCards.length,
          percent:
            meta.ayahCount > 0 ? Math.min(100, Math.round((masteredAyahs / meta.ayahCount) * 100)) : 0,
        });
      }
      setProgress(progressList);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your progress.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {};
    }, [refresh])
  );

  const goalAyahs = useMemo(() => (plan ? getGoalAyahCount(plan) : 0), [plan]);

  const planSurahSet = useMemo(() => new Set(plan ? getPlanSurahs(plan) : []), [plan]);

  const masteredAyahs = useMemo(() => {
    if (!plan) return 0;
    let total = 0;
    for (const card of cards) {
      if (card.status !== 'mastered' || !planSurahSet.has(card.surah)) continue;
      const startGlobal = globalAyahNumber({ surah: card.surah, ayah: card.startAyah });
      const endGlobal = globalAyahNumber({ surah: card.surah, ayah: card.endAyah });
      const from = Math.max(startGlobal, plan.goalStart);
      const to = Math.min(endGlobal, plan.goalEnd);
      if (to >= from) total += to - from + 1;
    }
    return total;
  }, [cards, plan, planSurahSet]);

  const overallPercent = goalAyahs > 0 ? Math.min(100, Math.round((masteredAyahs / goalAyahs) * 100)) : 0;
  const remainingAyahs = Math.max(0, goalAyahs - masteredAyahs);

  const milestones = useMemo<Milestone[]>(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const juz = i + 1;
      const start = juzStartGlobal(juz);
      const end = juz < 30 ? juzStartGlobal(juz + 1) - 1 : index.ayahCount;
      const size = Math.max(0, end - start + 1);
      let mastered = 0;
      for (const card of cards) {
        if (card.status !== 'mastered') continue;
        const cardStart = globalAyahNumber({ surah: card.surah, ayah: card.startAyah });
        const cardEnd = globalAyahNumber({ surah: card.surah, ayah: card.endAyah });
        const from = Math.max(cardStart, start);
        const to = Math.min(cardEnd, end);
        if (to >= from) mastered += to - from + 1;
      }
      const state: MilestoneState =
        size > 0 && mastered >= size ? 'full' : mastered > 0 ? 'partial' : 'none';
      return { juz, state };
    });
  }, [cards, index.ayahCount]);

  const forecastDays = useMemo(() => {
    if (remainingAyahs <= 0) return 0;
    if (logs.length === 0) return null;
    const cardByKey = new Map(cards.map((c) => [c.unitKey, c]));
    const reviewedKeys = new Set(logs.map((log) => log.cardKey));
    let reviewedAyahs = 0;
    for (const key of reviewedKeys) {
      const card = cardByKey.get(key);
      reviewedAyahs += card ? Math.max(1, card.endAyah - card.startAyah + 1) : 6;
    }
    const perDay = reviewedAyahs / FORECAST_DAYS;
    if (perDay <= 0) return null;
    return Math.ceil(remainingAyahs / perDay);
  }, [cards, logs, remainingAyahs]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.headerTitle}>{t('path.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : !plan ? (
          <View style={styles.center}>
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="map-outline" size={32} color={accent} />
              <ThemedText style={styles.emptyTitle}>No active plan yet</ThemedText>
              <ThemedText style={styles.emptyBody} themeColor="textSecondary">
                Create a plan to see your path through the Quran.
              </ThemedText>
              <Pressable
                onPress={() => router.push('/onboarding')}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: Brand.emerald },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Create a plan">
                <ThemedText style={styles.primaryBtnText}>Create a plan</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {error ? (
              <ThemedText style={styles.errorText} themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            <View style={[styles.ringCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.goalLabel} themeColor="textSecondary">
                {goalLabel(plan).toUpperCase()}
              </ThemedText>
              <View
                style={[
                  styles.ring,
                  { borderColor: overallPercent > 0 ? accent : theme.backgroundSelected },
                ]}
                accessibilityRole="progressbar"
                accessibilityLabel={`${overallPercent} percent of your goal mastered`}
                accessibilityValue={{ min: 0, max: 100, now: overallPercent }}>
                <View
                  style={[
                    styles.ringInner,
                    { backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText style={styles.ringPercent}>{overallPercent}%</ThemedText>
                  <ThemedText style={styles.ringCaption} themeColor="textSecondary">
                    mastered
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={styles.ringMeta} themeColor="textSecondary">
                {masteredAyahs.toLocaleString()} of {goalAyahs.toLocaleString()} ayahs
              </ThemedText>
              <View style={[styles.forecastPill, { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft }]}>
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={isDark ? '#fff' : Brand.emeraldDark}
                />
                <ThemedText style={[styles.forecastText, { color: isDark ? '#fff' : Brand.emeraldDark }]}>
                  {remainingAyahs <= 0
                    ? 'Goal complete — mashaAllah!'
                    : forecastDays === null
                      ? 'Start practicing to see your forecast'
                      : `~ ${forecastDays.toLocaleString()} days left`}
                </ThemedText>
              </View>
            </View>

            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              JUZ MILESTONES
            </ThemedText>
            <View style={styles.juzGrid}>
              {milestones.map(({ juz, state }) => {
                const bg =
                  state === 'full'
                    ? Brand.emerald
                    : state === 'partial'
                      ? isDark
                        ? Brand.goldDark
                        : Brand.goldSoft
                      : theme.backgroundElement;
                const border = state === 'partial' ? Brand.gold : 'transparent';
                const color = state === 'full' ? '#fff' : state === 'partial' ? (isDark ? '#fff' : Brand.goldDark) : theme.textSecondary;
                return (
                  <View
                    key={juz}
                    testID={`path-juz-${juz}`}
                    style={[styles.juzCell, { backgroundColor: bg, borderColor: border }]}
                    accessibilityLabel={`Juz ${juz}: ${state === 'full' ? 'mastered' : state === 'partial' ? 'in progress' : 'not started'}`}>
                    <ThemedText style={[styles.juzText, { color }]}>{juz}</ThemedText>
                  </View>
                );
              })}
            </View>

            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              SURAHS IN YOUR PATH
            </ThemedText>
            {progress.map((row) => {
              const meta = index.surahs[row.surah - 1];
              const isComplete = row.percent >= 100;
              const isStarted = row.percent > 0;
              const goldTone = isDark ? Brand.gold : Brand.goldDark;
              const statusColor = isComplete ? accent : isStarted ? goldTone : theme.textSecondary;
              const statusLabel = isComplete ? 'Mastered' : isStarted ? 'In progress' : 'Not started';
              return (
                <Pressable
                  key={row.surah}
                  testID={`path-surah-${row.surah}`}
                  onPress={() =>
                    router.push({ pathname: '/surah/[id]', params: { id: String(row.surah) } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Surah ${meta?.englishName ?? row.surah}, ${row.percent} percent mastered`}
                  style={({ pressed }) => [
                    styles.surahRow,
                    { backgroundColor: theme.backgroundElement },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <View
                    style={[
                      styles.surahMedallion,
                      {
                        backgroundColor: isComplete
                          ? Brand.emerald
                          : isStarted
                            ? goldTone
                            : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      style={[
                        styles.surahMedallionText,
                        { color: isComplete || isStarted ? '#fff' : theme.textSecondary },
                      ]}>
                      {row.surah}
                    </ThemedText>
                  </View>
                  <View style={styles.surahText}>
                    <View style={styles.surahTitleRow}>
                      <ThemedText style={styles.surahEnglish}>{meta?.englishName ?? `Surah ${row.surah}`}</ThemedText>
                      <ThemedText style={[styles.surahStatus, { color: statusColor }]}>
                        {statusLabel}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.surahArabic} themeColor="textSecondary">
                      {meta?.name ?? ''}
                    </ThemedText>
                    <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.min(100, row.percent)}%`,
                            backgroundColor: isComplete ? accent : goldTone,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <View style={styles.surahMeta}>
                    <ThemedText style={styles.surahPercent}>{row.percent}%</ThemedText>
                    <ThemedText style={styles.surahAyahs} themeColor="textSecondary">
                      {row.masteredAyahs}/{row.ayahCount}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 700 },
  headerRight: { width: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  body: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  errorText: { fontSize: 12 },
  ringCard: { borderRadius: 20, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  goalLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textAlign: 'center' },
  ring: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 118,
    height: 118,
    borderRadius: 59,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPercent: { fontSize: 34, fontWeight: 700, lineHeight: 40 },
  ringCaption: { fontSize: 11, fontWeight: 600 },
  ringMeta: { fontSize: 13 },
  forecastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    marginTop: 2,
  },
  forecastText: { fontSize: 12, fontWeight: 700 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginTop: Spacing.three },
  juzGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  juzCell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  juzText: { fontSize: 12, fontWeight: 700 },
  surahRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    padding: Spacing.three,
  },
  surahMedallion: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surahMedallionText: { fontSize: 14, fontWeight: 700 },
  surahText: { flex: 1, gap: 2 },
  surahTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  surahEnglish: { fontSize: 15, fontWeight: 700, flexShrink: 1 },
  surahStatus: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  surahArabic: { fontSize: 16, fontFamily: 'Amiri', textAlign: 'right', lineHeight: 22 },
  barTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 3 },
  barFill: { height: 5, borderRadius: 3 },
  surahMeta: { alignItems: 'flex-end', minWidth: 46 },
  surahPercent: { fontSize: 15, fontWeight: 700 },
  surahAyahs: { fontSize: 10 },
  emptyCard: { borderRadius: 20, padding: Spacing.four, alignItems: 'center', gap: Spacing.two, width: '100%', maxWidth: 420 },
  emptyTitle: { fontSize: 20, fontWeight: 700 },
  emptyBody: { fontSize: 14, textAlign: 'center' },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: 700 },
  pressed: { opacity: 0.85 },
});
