import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  ensureDb,
  getMasteredAyahCount,
  getReviewCount,
  getStreak,
  getTotalXp,
  type StreakRow,
} from '@/lib/db';
import { BADGES, checkBadges, getBadgeState, getEarnedBadges } from '@/lib/badges';
import { levelForXp, xpToNextLevel } from '@/lib/xp';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface StatCard {
  key: string;
  icon: IconName;
  value: string;
  label: string;
  color: string;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const t = useT();
  const router = useRouter();
  const accent = isDark ? '#43D6A3' : Brand.emerald;

  const [streak, setStreak] = useState<StreakRow | null>(null);
  const [xp, setXp] = useState(0);
  const [reviews, setReviews] = useState(0);
  const [mastered, setMastered] = useState(0);
  const [earnedBadges, setEarnedBadges] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await ensureDb();
      const [streakRow, totalXp, reviewCount, masteredAyahs] = await Promise.all([
        getStreak(),
        getTotalXp(),
        getReviewCount(),
        getMasteredAyahCount(),
      ]);
      setStreak(streakRow);
      setXp(totalXp);
      setReviews(reviewCount);
      setMastered(masteredAyahs);
      // Award anything newly earned, then show the full catalog state.
      try {
        await checkBadges(await getBadgeState());
        setEarnedBadges(await getEarnedBadges());
      } catch {
        setEarnedBadges([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your stats.');
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

  const level = levelForXp(xp);
  const toNext = xpToNextLevel(xp);

  const stats: StatCard[] = [
    {
      key: 'streak',
      icon: 'flame',
      value: String(streak?.current ?? 0),
      label: 'day streak',
      color: Brand.gold,
    },
    {
      key: 'best',
      icon: 'trophy-outline',
      value: String(streak?.best ?? 0),
      label: 'best streak',
      color: Brand.gold,
    },
    {
      key: 'freezes',
      icon: 'snow-outline',
      value: String(streak?.freezes ?? 0),
      label: 'streak freezes',
      color: isDark ? '#9CC7EA' : '#3F7FBF',
    },
    {
      key: 'reviews',
      icon: 'repeat-outline',
      value: reviews.toLocaleString(),
      label: 'total reviews',
      color: accent,
    },
  ];

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
          <ThemedText style={styles.headerTitle}>{t('profile.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {error ? (
              <ThemedText style={styles.errorText} themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            <View style={[styles.levelCard, { backgroundColor: theme.backgroundElement }]}>
              <View
                style={[styles.levelRing, { borderColor: level.progress > 0 ? accent : theme.backgroundSelected }]}
                accessibilityRole="progressbar"
                accessibilityLabel={`Level ${level.level}, ${Math.round(level.progress * 100)} percent to next level`}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(level.progress * 100) }}>
                <View style={[styles.levelInner, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={styles.levelNumber}>{level.level}</ThemedText>
                  <ThemedText style={styles.levelCaption} themeColor="textSecondary">
                    LEVEL
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={styles.xpTotal}>{xp.toLocaleString()} XP</ThemedText>
              <ThemedText style={styles.xpNext} themeColor="textSecondary">
                {toNext > 0 ? `${toNext.toLocaleString()} XP to level ${level.level + 1}` : 'Max level reached'}
              </ThemedText>
              <View style={[styles.xpTrack, { backgroundColor: theme.backgroundSelected }]}>
                <View
                  style={[
                    styles.xpFill,
                    { width: `${Math.round(level.progress * 100)}%`, backgroundColor: accent },
                  ]}
                />
              </View>
            </View>

            <View style={styles.statsGrid}>
              {stats.map((stat) => (
                <View
                  key={stat.key}
                  testID={`profile-stat-${stat.key}`}
                  style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name={stat.icon} size={22} color={stat.color} />
                  <ThemedText style={styles.statValue}>{stat.value}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    {stat.label}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={[styles.masteredCard, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.masteredIcon, { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft }]}>
                <Ionicons name="ribbon-outline" size={24} color={isDark ? '#fff' : Brand.emeraldDark} />
              </View>
              <View style={styles.masteredText}>
                <ThemedText style={styles.masteredValue}>
                  {mastered.toLocaleString()} ayahs mastered
                </ThemedText>
                <ThemedText style={styles.masteredLabel} themeColor="textSecondary">
                  A bayt of the Quran retained in your heart.
                </ThemedText>
              </View>
            </View>

            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              BADGES
            </ThemedText>
            <View style={[styles.badgesCard, { backgroundColor: theme.backgroundElement }]}>
              {BADGES.map((badge) => {
                const earned = earnedBadges.includes(badge.key);
                return (
                  <View key={badge.key} style={styles.badgeRowItem}>
                    <View
                      style={[
                        styles.badgeCircle,
                        {
                          borderColor: earned ? Brand.gold : theme.backgroundSelected,
                          backgroundColor: earned ? Brand.goldSoft : 'transparent',
                          opacity: earned ? 1 : 0.55,
                        },
                      ]}>
                      <ThemedText style={styles.badgeEmoji}>{badge.emoji}</ThemedText>
                    </View>
                    <View style={styles.badgeInfo}>
                      <ThemedText style={styles.badgeName} type="smallBold">
                        {badge.name}
                      </ThemedText>
                      <ThemedText style={styles.badgeDesc} themeColor="textSecondary" type="small">
                        {badge.description}
                      </ThemedText>
                    </View>
                    {earned ? (
                      <Ionicons name="checkmark-circle" size={20} color={Brand.gold} />
                    ) : (
                      <Ionicons name="lock-closed-outline" size={18} color={theme.textSecondary} />
                    )}
                  </View>
                );
              })}
            </View>

            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [
                styles.settingsBtn,
                { backgroundColor: theme.backgroundElement },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              testID="profile-settings">
              <Ionicons name="settings-outline" size={20} color={theme.text} />
              <ThemedText style={styles.settingsText}>Settings</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  errorText: { fontSize: 12 },
  levelCard: { borderRadius: 20, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  levelRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelInner: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center' },
  levelNumber: { fontSize: 36, fontWeight: 700, lineHeight: 42 },
  levelCaption: { fontSize: 10, fontWeight: 700, letterSpacing: 1.5 },
  xpTotal: { fontSize: 22, fontWeight: 700 },
  xpNext: { fontSize: 12 },
  xpTrack: { height: 6, borderRadius: 3, overflow: 'hidden', width: '100%', marginTop: Spacing.one },
  xpFill: { height: 6, borderRadius: 3 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: 700, marginTop: 2 },
  statLabel: { fontSize: 11, fontWeight: 600 },
  masteredCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, padding: Spacing.three },
  masteredIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  masteredText: { flex: 1 },
  masteredValue: { fontSize: 16, fontWeight: 700 },
  masteredLabel: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginTop: Spacing.three },
  badgesCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  badgeRowItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  badgeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeEmoji: { fontSize: 22 },
  badgeInfo: { flex: 1 },
  badgeName: { fontSize: 14 },
  badgeDesc: { fontSize: 12, lineHeight: 16 },
  badgesText: { fontSize: 13, textAlign: 'center' },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  settingsText: { fontSize: 15, fontWeight: 600, flex: 1 },
});
