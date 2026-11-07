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
import { loadTodaySession, type TodaySession } from '@/lib/modes';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface PracticeMode {
  key: string;
  label: string;
  caption: string;
  icon: IconName;
  route: Href;
  testID: string;
}

const MODES: PracticeMode[] = [
  {
    key: 'flashcards',
    label: 'Flashcards',
    caption: 'Reveal the ayah, then self-grade',
    icon: 'albums-outline',
    route: '/practice/flashcards',
    testID: 'practice-mode-flashcards',
  },
  {
    key: 'hide-ayah',
    label: 'Hide & Recite',
    caption: 'Recite the next ayah from memory',
    icon: 'eye-off-outline',
    route: '/practice/hide-ayah',
    testID: 'practice-mode-hide-ayah',
  },
  {
    key: 'scratch',
    label: 'Scratch',
    caption: 'Scratch the cover to uncover',
    icon: 'brush-outline',
    route: '/practice/scratch',
    testID: 'practice-mode-scratch',
  },
  {
    key: 'quiz',
    label: 'Quiz',
    caption: 'Next ayah, blanks, order, listening',
    icon: 'help-circle-outline',
    route: '/practice/quiz',
    testID: 'practice-mode-quiz',
  },
];

export default function PracticeScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const accent = isDark ? '#43D6A3' : Brand.emerald;

  const [session, setSession] = useState<TodaySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadTodaySession(20);
      setSession(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your practice queue.');
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

  const plan = session?.plan ?? null;
  const totalBlocks =
    (session?.sabaqCount ?? 0) + (session?.sabqiCount ?? 0) + (session?.manzilCount ?? 0);
  const hasSession = Boolean(plan) && totalBlocks > 0;
  const dueNow = session
    ? session.cards.filter((card) => card.due <= Date.now()).length
    : 0;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="practice-back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText style={styles.headerTitle}>Practice</ThemedText>
            <ThemedText style={styles.headerSub} themeColor="textSecondary">
              {dueNow > 0 ? `${dueNow} due now` : 'Review at your own pace'}
            </ThemedText>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={accent} />
            <ThemedText themeColor="textSecondary" style={styles.loadingText}>
              Building your session…
            </ThemedText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={[styles.errorCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.errorText} themeColor="textSecondary">
                  {error}
                </ThemedText>
              </View>
            ) : null}

            {hasSession && session ? (
              <View style={[styles.sessionCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.sessionTop}>
                  <View style={styles.sessionTitleWrap}>
                    <ThemedText style={styles.eyebrow} themeColor="textSecondary">
                      TODAY&apos;S SESSION
                    </ThemedText>
                    <ThemedText style={styles.sessionTitle}>
                      {session.cards.length} {session.cards.length === 1 ? 'card' : 'cards'} ready
                    </ThemedText>
                    <ThemedText style={styles.sessionSub} themeColor="textSecondary">
                      SABAQ first, then your SABQI and MANZIL review, interleaved.
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.sessionIcon,
                      { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                    ]}>
                    <Ionicons
                      name="sparkles-outline"
                      size={22}
                      color={isDark ? '#fff' : Brand.emeraldDark}
                    />
                  </View>
                </View>

                <View style={styles.chipRow}>
                  <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText style={styles.chipLabel} themeColor="textSecondary">
                      SABAQ
                    </ThemedText>
                    <ThemedText style={styles.chipValue}>{session.sabaqCount}</ThemedText>
                  </View>
                  <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText style={styles.chipLabel} themeColor="textSecondary">
                      SABQI
                    </ThemedText>
                    <ThemedText style={styles.chipValue}>{session.sabqiCount}</ThemedText>
                  </View>
                  <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText style={styles.chipLabel} themeColor="textSecondary">
                      MANZIL
                    </ThemedText>
                    <ThemedText style={styles.chipValue}>{session.manzilCount}</ThemedText>
                  </View>
                </View>

                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/practice/flashcards',
                      params: { session: 'today' },
                    })
                  }
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: accent },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Start today's session"
                  testID="practice-start-today">
                  <Ionicons name="play" size={18} color={isDark ? '#06231B' : '#fff'} />
                  <ThemedText
                    style={[
                      styles.primaryBtnText,
                      { color: isDark ? '#06231B' : '#fff' },
                    ]}>
                    Start today&apos;s session
                  </ThemedText>
                </Pressable>
              </View>
            ) : plan ? (
              <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                <View
                  style={[
                    styles.emptyIcon,
                    { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                  ]}>
                  <Ionicons
                    name="checkmark-circle"
                    size={28}
                    color={isDark ? '#fff' : Brand.emeraldDark}
                  />
                </View>
                <ThemedText style={styles.emptyTitle}>All caught up for today</ThemedText>
                <ThemedText style={styles.emptyBody} themeColor="textSecondary">
                  Your plan has no SABAQ or revision left today. Free practice still works — pick a
                  mode below.
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                <View
                  style={[
                    styles.emptyIcon,
                    { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                  ]}>
                  <Ionicons
                    name="school-outline"
                    size={28}
                    color={isDark ? '#fff' : Brand.emeraldDark}
                  />
                </View>
                <ThemedText style={styles.emptyTitle}>Practice needs a plan</ThemedText>
                <ThemedText style={styles.emptyBody} themeColor="textSecondary">
                  Complete your first lesson — create a plan on the Today screen. Your SABAQ,
                  SABQI and MANZIL chunks become the practice queue.
                </ThemedText>
                <Pressable
                  onPress={() => router.push('/')}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: accent },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open the Today screen"
                  testID="practice-open-today">
                  <ThemedText style={[styles.secondaryBtnText, { color: accent }]}>
                    Open Today
                  </ThemedText>
                  <Ionicons name="arrow-forward" size={16} color={accent} />
                </Pressable>
              </View>
            )}

            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              {hasSession ? 'OR PRACTICE FREELY' : 'CHOOSE A MODE'}
            </ThemedText>

            <View style={styles.grid}>
              {MODES.map((mode) => (
                <Pressable
                  key={mode.key}
                  onPress={() => router.push(mode.route)}
                  accessibilityRole="button"
                  accessibilityLabel={`${mode.label} — ${mode.caption}`}
                  testID={mode.testID}
                  style={({ pressed }) => [
                    styles.modeCard,
                    { backgroundColor: theme.backgroundElement },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <View
                    style={[
                      styles.modeIcon,
                      { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                    ]}>
                    <Ionicons
                      name={mode.icon}
                      size={20}
                      color={isDark ? '#fff' : Brand.emeraldDark}
                    />
                  </View>
                  <ThemedText style={styles.modeLabel}>{mode.label}</ThemedText>
                  <ThemedText style={styles.modeCaption} themeColor="textSecondary">
                    {mode.caption}
                  </ThemedText>
                  <View style={styles.modeArrow}>
                    <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                  </View>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.footer} themeColor="textSecondary">
              Each attempt earns XP. Grades: Again / Hard / Good / Easy.
            </ThemedText>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: 700 },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerSpacer: { width: 38 },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  loadingText: { fontSize: 13 },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  errorCard: { borderRadius: 12, padding: Spacing.three },
  errorText: { fontSize: 13 },
  sessionCard: { borderRadius: 20, padding: Spacing.three, gap: Spacing.three },
  sessionTop: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  sessionTitleWrap: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 10, fontWeight: 700, letterSpacing: 1.2 },
  sessionTitle: { fontSize: 24, fontWeight: 700 },
  sessionSub: { fontSize: 12, lineHeight: 17 },
  sessionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: 1,
  },
  chipLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 0.8 },
  chipValue: { fontSize: 18, fontWeight: 700 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
  },
  primaryBtnText: { fontSize: 16, fontWeight: 700 },
  pressed: { opacity: 0.85 },
  emptyCard: {
    borderRadius: 20,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  emptyTitle: { fontSize: 20, fontWeight: 700, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.one,
    width: '100%',
  },
  secondaryBtnText: { fontSize: 15, fontWeight: 700 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    marginTop: Spacing.three,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  modeCard: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 2,
    minHeight: 132,
  },
  modeIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  modeLabel: { fontSize: 16, fontWeight: 700 },
  modeCaption: { fontSize: 11, lineHeight: 15, paddingRight: Spacing.two },
  modeArrow: { position: 'absolute', right: Spacing.two, bottom: Spacing.two },
  footer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
