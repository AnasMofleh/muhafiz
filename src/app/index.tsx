import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import {
  ensureDb,
  getActivePlan,
  getStreak,
  getTotalXp,
  localDateKey,
  recordActivity,
  savePlanDay,
  type PlanDayRow,
  type PlanRow,
  type StreakRow,
} from '@/lib/db';
import {
  generatePlanDay,
  planDayEtaMinutes,
  planDayUnits,
  sumUnitAyahs,
} from '@/lib/scheduler';
import { levelForXp } from '@/lib/xp';

type BlockKey = 'sabaq' | 'sabqi' | 'manzil';
type IconName = ComponentProps<typeof Ionicons>['name'];

interface NavItem {
  key: string;
  label: string;
  caption: string;
  icon: IconName;
  route: Href;
  testID: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'mushaf', label: 'Mushaf', caption: 'Read the Quran', icon: 'book-outline', route: '/mushaf', testID: 'nav-mushaf' },
  { key: 'path', label: 'Path', caption: 'Your progress', icon: 'map-outline', route: '/path', testID: 'nav-path' },
  { key: 'practice', label: 'Practice', caption: 'Review session', icon: 'play-circle-outline', route: '/practice', testID: 'nav-practice' },
  { key: 'recite', label: 'Recite', caption: 'Check recitation', icon: 'mic-outline', route: '/recite', testID: 'nav-recite' },
  { key: 'social', label: 'Challenges', caption: 'Friends & groups', icon: 'people-outline', route: '/social', testID: 'nav-social' },
  { key: 'settings', label: 'Settings', caption: 'Reciter & text', icon: 'settings-outline', route: '/settings', testID: 'nav-settings' },
];

export default function TodayScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const accent = isDark ? '#43D6A3' : Brand.emerald;

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [day, setDay] = useState<PlanDayRow | null>(null);
  const [streak, setStreak] = useState<StreakRow | null>(null);
  const [xp, setXp] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureDb();
      const active = await getActivePlan();
      if (!active) {
        setPlan(null);
        setDay(null);
        const [streakRow, totalXp] = await Promise.all([getStreak(), getTotalXp()]);
        setStreak(streakRow);
        setXp(totalXp);
        setError(null);
        return;
      }
      const [todayDay, streakRow, totalXp] = await Promise.all([
        generatePlanDay(active, localDateKey()),
        getStreak(),
        getTotalXp(),
      ]);
      setPlan(active);
      setDay(todayDay);
      setStreak(streakRow);
      setXp(totalXp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your plan.');
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

  const toggleBlock = useCallback(
    async (block: BlockKey) => {
      if (!day) return;
      const wasDone =
        block === 'sabaq' ? day.doneSabaq : block === 'sabqi' ? day.doneSabqi : day.doneManzil;
      const next: PlanDayRow = {
        ...day,
        doneSabaq: block === 'sabaq' ? !day.doneSabaq : day.doneSabaq,
        doneSabqi: block === 'sabqi' ? !day.doneSabqi : day.doneSabqi,
        doneManzil: block === 'manzil' ? !day.doneManzil : day.doneManzil,
      };
      setDay(next);
      try {
        await savePlanDay(next);
        if (!wasDone) {
          const updated = await recordActivity(localDateKey());
          setStreak(updated);
        }
      } catch {
        // Keep the optimistic UI; the next focus reload reconciles it.
      }
    },
    [day]
  );

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.center}>
          <ActivityIndicator size="large" color={accent} />
          <ThemedText themeColor="textSecondary" style={styles.loadingText}>
            Preparing today&apos;s plan…
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const level = levelForXp(xp);
  const blocks = day
    ? [
        {
          key: 'sabaq' as BlockKey,
          title: 'SABAQ',
          caption: "Today's new lesson",
          keys: day.sabaq,
          done: day.doneSabaq,
          testID: 'block-sabaq',
          icon: 'sparkles-outline' as IconName,
        },
        {
          key: 'sabqi' as BlockKey,
          title: 'SABQI',
          caption: 'Recent revision · last 7 days',
          keys: day.sabqi,
          done: day.doneSabqi,
          testID: 'block-sabqi',
          icon: 'refresh-outline' as IconName,
        },
        {
          key: 'manzil' as BlockKey,
          title: 'MANZIL',
          caption: 'Older revision',
          keys: day.manzil,
          done: day.doneManzil,
          testID: 'block-manzil',
          icon: 'library-outline' as IconName,
        },
      ]
    : [];
  const totalUnits = day ? planDayUnits(day).length : 0;
  const minutes = day ? planDayEtaMinutes(day) : 1;
  const doneBlocks = blocks.filter((b) => b.done).length;
  const dueCards = day ? day.sabqi.length + day.manzil.length : 0;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText style={[styles.appName, { color: accent }]}>Muhafiz</ThemedText>
              <ThemedText style={styles.appSub} themeColor="textSecondary">
                {day ? `${doneBlocks} of 3 blocks done today` : 'Your memorization companion'}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => router.push('/profile')}
              style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Profile and stats"
              testID="today-profile">
              <Ionicons name="person-circle-outline" size={24} color={theme.text} />
            </Pressable>
          </View>

          {error ? (
            <View style={[styles.errorCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.errorText} themeColor="textSecondary">
                {error}
              </ThemedText>
            </View>
          ) : null}

          {!plan ? (
            <View style={[styles.welcomeCard, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.welcomeIcon, { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft }]}>
                <Ionicons name="book" size={36} color={isDark ? '#fff' : Brand.emeraldDark} />
              </View>
              <ThemedText style={styles.welcomeTitle}>Create your memorization plan</ThemedText>
              <ThemedText style={styles.welcomeBody} themeColor="textSecondary">
                Choose what to memorize, how much per day, and get a daily SABAQ · SABQI · MANZIL
                schedule built around your life.
              </ThemedText>
              <Pressable
                onPress={() => router.push('/onboarding')}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: Brand.emerald },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Create your memorization plan"
                testID="today-create-plan">
                <ThemedText style={styles.primaryBtnText}>Get started</ThemedText>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.statsRow}>
                <View style={[styles.statChip, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="flame" size={20} color={Brand.gold} />
                  <ThemedText style={styles.statValue}>{streak?.current ?? 0}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    day streak
                  </ThemedText>
                </View>
                <View style={[styles.statChip, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="snow-outline" size={20} color={isDark ? '#9CC7EA' : '#3F7FBF'} />
                  <ThemedText style={styles.statValue}>{streak?.freezes ?? 0}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    freezes
                  </ThemedText>
                </View>
                <View style={[styles.statChip, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="star" size={20} color={Brand.gold} />
                  <ThemedText style={styles.statValue}>Lv {level.level}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    {xp} XP
                  </ThemedText>
                </View>
              </View>

              <View style={[styles.startCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.startTop}>
                  <View>
                    <ThemedText style={styles.startEyebrow} themeColor="textSecondary">
                      TODAY&apos;S SESSION · {dueCards} DUE
                    </ThemedText>
                    <ThemedText style={styles.startTitle}>
                      {totalUnits === 0 ? 'All caught up' : `${totalUnits} chunks ready`}
                    </ThemedText>
                  </View>
                  <View style={[styles.etaPill, { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft }]}>
                    <Ionicons name="time-outline" size={14} color={isDark ? '#fff' : Brand.emeraldDark} />
                    <ThemedText
                      style={[styles.etaText, { color: isDark ? '#fff' : Brand.emeraldDark }]}>
                      ~{minutes} min
                    </ThemedText>
                  </View>
                </View>
                <Pressable
                  onPress={() => router.push('/practice')}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: Brand.emerald },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Start today's session"
                  testID="today-start">
                  <Ionicons name="play" size={18} color="#fff" />
                  <ThemedText style={styles.primaryBtnText}>Start today&apos;s session</ThemedText>
                </Pressable>
              </View>

              {blocks.map((block) => {
                const ayahs = sumUnitAyahs(block.keys);
                return (
                  <Pressable
                    key={block.key}
                    testID={block.testID}
                    onPress={() => void toggleBlock(block.key)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${block.title}, ${ayahs} ayahs, ${block.done ? 'done' : 'not done'}`}
                    accessibilityState={{ checked: block.done }}
                    style={({ pressed }) => [
                      styles.blockRow,
                      { backgroundColor: theme.backgroundElement },
                      pressed && { backgroundColor: theme.backgroundSelected },
                      block.done && styles.blockDone,
                    ]}>
                    <Ionicons
                      name={block.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={26}
                      color={block.done ? accent : theme.textSecondary}
                    />
                    <View style={styles.blockText}>
                      <View style={styles.blockTitleRow}>
                        <Ionicons name={block.icon} size={14} color={accent} />
                        <ThemedText style={styles.blockTitle}>{block.title}</ThemedText>
                        <ThemedText style={styles.blockCount} themeColor="textSecondary">
                          {block.keys.length} {block.keys.length === 1 ? 'chunk' : 'chunks'} · {ayahs}{' '}
                          ayahs
                        </ThemedText>
                      </View>
                      <ThemedText style={styles.blockCaption} themeColor="textSecondary">
                        {block.caption}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                EXPLORE
              </ThemedText>
              <View style={styles.navGrid}>
                {NAV_ITEMS.map((item) => (
                  <Pressable
                    key={item.key}
                    testID={item.testID}
                    onPress={() => router.push(item.route)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} — ${item.caption}`}
                    style={({ pressed }) => [
                      styles.navCard,
                      { backgroundColor: theme.backgroundElement },
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}>
                    <View
                      style={[
                        styles.navIcon,
                        { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                      ]}>
                      <Ionicons
                        name={item.icon}
                        size={20}
                        color={isDark ? '#fff' : Brand.emeraldDark}
                      />
                    </View>
                    <ThemedText style={styles.navLabel}>{item.label}</ThemedText>
                    <ThemedText style={styles.navCaption} themeColor="textSecondary">
                      {item.caption}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  loadingText: { fontSize: 13 },
  body: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  headerText: { flex: 1 },
  appName: { fontSize: 30, fontWeight: 700 },
  appSub: { fontSize: 13, marginTop: 1 },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  errorCard: { borderRadius: 12, padding: Spacing.three },
  errorText: { fontSize: 13 },
  welcomeCard: {
    borderRadius: 20,
    padding: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
    minHeight: 380,
  },
  welcomeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  welcomeTitle: { fontSize: 22, fontWeight: 700, textAlign: 'center' },
  welcomeBody: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
    width: '100%',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 700 },
  pressed: { opacity: 0.85 },
  statsRow: { flexDirection: 'row', gap: Spacing.two },
  statChip: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 16, fontWeight: 700 },
  statLabel: { fontSize: 10, fontWeight: 600 },
  startCard: { borderRadius: 20, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.one },
  startTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  startEyebrow: { fontSize: 10, fontWeight: 700, letterSpacing: 1.2 },
  startTitle: { fontSize: 24, fontWeight: 700, marginTop: 2 },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
  },
  etaText: { fontSize: 12, fontWeight: 700 },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    padding: Spacing.three,
  },
  blockDone: { opacity: 0.7 },
  blockText: { flex: 1 },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  blockTitle: { fontSize: 15, fontWeight: 700, letterSpacing: 0.5 },
  blockCount: { fontSize: 11, fontWeight: 600, marginLeft: 2 },
  blockCaption: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginTop: Spacing.three },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  navCard: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  navIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  navLabel: { fontSize: 15, fontWeight: 700 },
  navCaption: { fontSize: 11 },
});
