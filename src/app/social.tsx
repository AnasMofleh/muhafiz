import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getIndex } from '@/data/quran';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import {
  challengeProgress,
  makeChallengeCode,
  parseChallengeFromText,
} from '@/lib/challenges';
import {
  completeChallenge,
  createChallenge,
  ensureDb,
  getAllCards,
  getChallenges,
  getMasteredAyahCount,
  getStreak,
  getTotalXp,
  type CardRow,
  type ChallengeRow,
  type StreakRow,
} from '@/lib/db';
import {
  appShareText,
  challengeShareText,
  progressCardText,
  shareText,
  waLink,
} from '@/lib/share';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS = 3;
const MAX_DAYS = 60;
const DEFAULT_JOIN_DAYS = 30;

type IconName = ComponentProps<typeof Ionicons>['name'];

function clampSurah(value: number): number {
  return Math.min(114, Math.max(1, Math.round(value)));
}

function surahRangeLabel(from: number, to: number): string {
  const surahs = getIndex().surahs;
  const first = surahs[clampSurah(from) - 1]?.englishName ?? `Surah ${from}`;
  const last = surahs[clampSurah(to) - 1]?.englishName ?? `Surah ${to}`;
  return from === to ? first : `${first} – ${last}`;
}

function deadlineMs(deadline: string | number): number {
  const numeric = typeof deadline === 'number' ? deadline : Number(deadline);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(String(deadline)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysLeftLabel(deadline: string | number): string {
  const remaining = deadlineMs(deadline) - Date.now();
  if (remaining <= 0) return 'Ended';
  const daysLeft = Math.ceil(remaining / DAY_MS);
  return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
}

interface SurahStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function SurahStepper({ label, value, min, max, onChange }: SurahStepperProps) {
  const theme = useTheme();
  const meta = getIndex().surahs[clampSurah(value) - 1];
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <View style={[styles.stepperCard, { backgroundColor: theme.background }]}>
      <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={!canDecrease}
          style={({ pressed }) => [
            styles.stepBtn,
            { borderColor: theme.backgroundSelected },
            pressed && canDecrease && { backgroundColor: theme.backgroundSelected },
            !canDecrease && styles.stepBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Previous surah, ${label.toLowerCase()} picker`}
          accessibilityState={{ disabled: !canDecrease }}>
          <Ionicons name="remove" size={18} color={theme.text} />
        </Pressable>
        <View style={styles.stepperMiddle}>
          <ThemedText style={styles.surahNumber}>{value}</ThemedText>
          <ThemedText style={styles.surahName} numberOfLines={1}>
            {meta?.englishName ?? `Surah ${value}`}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={!canIncrease}
          style={({ pressed }) => [
            styles.stepBtn,
            { borderColor: theme.backgroundSelected },
            pressed && canIncrease && { backgroundColor: theme.backgroundSelected },
            !canIncrease && styles.stepBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Next surah, ${label.toLowerCase()} picker`}
          accessibilityState={{ disabled: !canIncrease }}>
          <Ionicons name="add" size={18} color={theme.text} />
        </Pressable>
      </View>
      <ThemedText
        style={[styles.surahArabic, { color: theme.textSecondary }]}
        numberOfLines={1}
        accessibilityLanguage="ar">
        {meta?.name ?? ''}
      </ThemedText>
    </View>
  );
}

export default function SocialScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const t = useT();
  const router = useRouter();

  const accent = isDark ? '#43D6A3' : Brand.emerald;
  const buttonBg = isDark ? Brand.emeraldDark : Brand.emerald;
  const whatsappColor = isDark ? '#43D6A3' : Brand.emerald;
  const softIconBg = isDark ? Brand.emeraldDark : Brand.emeraldSoft;
  const onSoftIcon = isDark ? '#ffffff' : Brand.emeraldDark;
  const errorColor = isDark ? '#FFB4AB' : '#B3261E';

  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [masteredCards, setMasteredCards] = useState<CardRow[]>([]);
  const [streak, setStreak] = useState<StreakRow | null>(null);
  const [xp, setXp] = useState(0);
  const [masteredAyahs, setMasteredAyahs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create form
  const [title, setTitle] = useState('');
  const [surahFrom, setSurahFrom] = useState(1);
  const [surahTo, setSurahTo] = useState(1);
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Join by code
  const [joinText, setJoinText] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinedCode, setJoinedCode] = useState<string | null>(null);

  // Transient feedback after sharing.
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2600);
    return () => clearTimeout(timer);
  }, [feedback]);

  const refresh = useCallback(async () => {
    try {
      await ensureDb();
      const [rows, streakRow, totalXp, masteredCount, allCards] = await Promise.all([
        getChallenges(),
        getStreak(),
        getTotalXp(),
        getMasteredAyahCount(),
        getAllCards(),
      ]);
      // Auto-complete challenges that reached 100% or passed their deadline,
      // so ended challenges never linger in the active list.
      const mastered = allCards.filter((card) => card.status === 'mastered');
      const now = Date.now();
      for (const challenge of rows) {
        if (challenge.completedAt !== null) continue;
        const progress = challengeProgress(challenge, mastered);
        const deadline = deadlineMs(challenge.deadline);
        const expired = deadline > 0 && deadline <= now;
        if (progress.pct >= 100 || expired) {
          await completeChallenge(challenge.id);
        }
      }
      const finalRows = rows.some(
        (c) => c.completedAt === null && (challengeProgress(c, mastered).pct >= 100 || (deadlineMs(c.deadline) > 0 && deadlineMs(c.deadline) <= now))
      )
        ? await getChallenges()
        : rows;
      setChallenges(finalRows);
      setStreak(streakRow);
      setXp(totalXp);
      setMasteredAyahs(masteredCount);
      setMasteredCards(mastered);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your challenges.');
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

  const handleShareText = useCallback(async (text: string) => {
    const result = await shareText(text);
    if (result.message) setFeedback(result.message);
  }, []);

  const handleWhatsApp = useCallback(
    async (text: string) => {
      try {
        await Linking.openURL(waLink(text));
      } catch {
        await handleShareText(text);
      }
    },
    [handleShareText]
  );

  const handleCreate = useCallback(async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('Give your challenge a title first.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await ensureDb();
      await createChallenge({
        title: cleanTitle,
        surahFrom,
        surahTo,
        days,
        deadline: Date.now() + days * DAY_MS,
        code: makeChallengeCode(),
      });
      setTitle('');
      setFeedback('Challenge created!');
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the challenge.');
    } finally {
      setCreating(false);
    }
  }, [title, surahFrom, surahTo, days, refresh]);

  const handleJoin = useCallback(async () => {
    const raw = joinText.trim();
    if (!raw) {
      setJoinError('Paste a challenge message or code.');
      return;
    }
    // Allow either the full invite text or a bare code.
    const parsed = parseChallengeFromText(raw.includes(' ') ? raw : `code ${raw}`);
    if (!parsed) {
      setJoinError('That does not look like a challenge code.');
      return;
    }
    if (challenges.some((challenge) => challenge.code.toUpperCase() === parsed.code)) {
      setJoinError('That challenge is already on this device.');
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      await ensureDb();
      // Reconstruct the inviter's scope when the invite carries the CH: payload;
      // a bare code falls back to a whole-Quran 30-day challenge.
      const surahFrom = parsed.surahFrom ?? 1;
      const surahTo = parsed.surahTo ?? 114;
      const days = parsed.days ?? DEFAULT_JOIN_DAYS;
      await createChallenge({
        title: parsed.title || `Shared challenge ${parsed.code}`,
        surahFrom,
        surahTo,
        days,
        deadline: Date.now() + days * DAY_MS,
        code: parsed.code,
      });
      setJoinedCode(parsed.code);
      setJoinText('');
      await refresh();
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not join that challenge.');
    } finally {
      setJoining(false);
    }
  }, [joinText, challenges, refresh]);

  const streakDays = streak?.current ?? 0;
  const progressMessage = progressCardText(streakDays, xp, masteredAyahs);

  const changeSurahFrom = useCallback((value: number) => {
    const next = clampSurah(value);
    setSurahFrom(next);
    setSurahTo((current) => (next > current ? next : current));
  }, []);

  const changeSurahTo = useCallback((value: number) => {
    const next = clampSurah(value);
    setSurahTo(next);
    setSurahFrom((current) => (next < current ? next : current));
  }, []);

  const activeChallenges = challenges.filter((challenge) => challenge.completedAt === null);
  const completedChallenges = challenges.filter((challenge) => challenge.completedAt !== null);

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
          <ThemedText style={styles.headerTitle}>{t('social.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        {feedback ? (
          <View
            style={[styles.toast, { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft }]}
            accessibilityLiveRegion="polite">
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={isDark ? '#8FE8C7' : Brand.emeraldDark}
            />
            <ThemedText style={[styles.toastText, { color: isDark ? '#ffffff' : Brand.emeraldDark }]}>
              {feedback}
            </ThemedText>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {loadError ? (
              <ThemedText style={[styles.errorText, { color: errorColor }]}>{loadError}</ThemedText>
            ) : null}

            {/* Create challenge */}
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHeading}>
                <View style={[styles.cardIcon, { backgroundColor: softIconBg }]}>
                  <Ionicons name="flag-outline" size={18} color={onSoftIcon} />
                </View>
                <View style={styles.headingText}>
                  <ThemedText style={styles.cardTitle}>Create a challenge</ThemedText>
                  <ThemedText style={styles.cardSubtitle} themeColor="textSecondary">
                    Pick a range, set a pace, invite friends.
                  </ThemedText>
                </View>
              </View>

              <TextInput
                value={title}
                onChangeText={(value) => {
                  setTitle(value);
                  if (formError) setFormError(null);
                }}
                placeholder="Challenge name, e.g. Juz 30 in a month"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.background,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
                accessibilityLabel="Challenge title"
                testID="social-title-input"
                maxLength={60}
                returnKeyType="done"
              />

              <View style={styles.pickersRow}>
                <SurahStepper
                  label="From"
                  value={surahFrom}
                  min={1}
                  max={surahTo}
                  onChange={changeSurahFrom}
                />
                <SurahStepper
                  label="To"
                  value={surahTo}
                  min={surahFrom}
                  max={114}
                  onChange={changeSurahTo}
                />
              </View>

              <View style={[styles.daysCard, { backgroundColor: theme.background }]}>
                <View>
                  <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
                    Finish in
                  </ThemedText>
                  <ThemedText style={styles.daysValue}>
                    {days} {days === 1 ? 'day' : 'days'}
                  </ThemedText>
                </View>
                <View style={styles.daysControls}>
                  <Pressable
                    onPress={() => setDays((current) => Math.max(MIN_DAYS, current - 1))}
                    disabled={days <= MIN_DAYS}
                    style={({ pressed }) => [
                      styles.stepBtn,
                      { borderColor: theme.backgroundSelected },
                      pressed && days > MIN_DAYS && { backgroundColor: theme.backgroundSelected },
                      days <= MIN_DAYS && styles.stepBtnDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Fewer days"
                    accessibilityState={{ disabled: days <= MIN_DAYS }}>
                    <Ionicons name="remove" size={18} color={theme.text} />
                  </Pressable>
                  <Pressable
                    onPress={() => setDays((current) => Math.min(MAX_DAYS, current + 1))}
                    disabled={days >= MAX_DAYS}
                    style={({ pressed }) => [
                      styles.stepBtn,
                      { borderColor: theme.backgroundSelected },
                      pressed && days < MAX_DAYS && { backgroundColor: theme.backgroundSelected },
                      days >= MAX_DAYS && styles.stepBtnDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="More days"
                    accessibilityState={{ disabled: days >= MAX_DAYS }}>
                    <Ionicons name="add" size={18} color={theme.text} />
                  </Pressable>
                </View>
              </View>

              <ThemedText style={styles.rangeSummary} themeColor="textSecondary">
                {surahRangeLabel(surahFrom, surahTo)} · {days} days
              </ThemedText>

              {formError ? (
                <ThemedText style={[styles.errorText, { color: errorColor }]}>{formError}</ThemedText>
              ) : null}

              <Pressable
                onPress={() => void handleCreate()}
                disabled={creating}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: buttonBg },
                  (pressed || creating) && styles.primaryBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Create challenge"
                accessibilityState={{ disabled: creating, busy: creating }}
                testID="social-create">
                {creating ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={18} color="#ffffff" />
                    <ThemedText style={styles.primaryBtnText}>Create challenge</ThemedText>
                  </>
                )}
              </Pressable>
            </View>

            {/* Active challenges */}
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                ACTIVE CHALLENGES
              </ThemedText>
              <ThemedText style={styles.sectionCount} themeColor="textSecondary">
                {activeChallenges.length}
              </ThemedText>
            </View>

            {activeChallenges.length === 0 ? (
              <View
                style={[styles.card, styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="people-outline" size={28} color={theme.textSecondary} />
                <ThemedText style={styles.emptyTitle}>No challenges yet</ThemedText>
                <ThemedText style={styles.emptyText} themeColor="textSecondary">
                  Create one above, or join a friend with their code.
                </ThemedText>
              </View>
            ) : (
              activeChallenges.map((challenge) => {
                const progress = challengeProgress(challenge, masteredCards);
                return (
                  <View
                    key={challenge.id}
                    style={[styles.card, { backgroundColor: theme.backgroundElement }]}
                    testID={`social-challenge-${challenge.id}`}>
                    <View style={styles.challengeHeader}>
                      <View style={styles.challengeHeading}>
                        <ThemedText style={styles.challengeTitle} numberOfLines={2}>
                          {challenge.title}
                        </ThemedText>
                        <ThemedText
                          style={styles.cardSubtitle}
                          themeColor="textSecondary"
                          numberOfLines={1}>
                          {surahRangeLabel(challenge.surahFrom, challenge.surahTo)} ·{' '}
                          {challenge.days} days
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.codeChip,
                          { backgroundColor: isDark ? Brand.goldDark : Brand.goldSoft },
                        ]}>
                        <ThemedText
                          style={styles.codeText}
                          themeColor={isDark ? 'text' : undefined}>
                          {challenge.code}
                        </ThemedText>
                      </View>
                    </View>

                    <View style={styles.progressMetaRow}>
                      <ThemedText style={styles.metaText} themeColor="textSecondary">
                        {daysLeftLabel(challenge.deadline)}
                      </ThemedText>
                      <ThemedText style={styles.metaText} themeColor="textSecondary">
                        {progress.done} / {progress.total} ayahs
                      </ThemedText>
                    </View>

                    <View
                      style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}
                      accessibilityRole="progressbar"
                      accessibilityLabel={`${challenge.title} progress`}
                      accessibilityValue={{ min: 0, max: 100, now: progress.pct }}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${progress.pct}%`, backgroundColor: accent },
                        ]}
                      />
                    </View>
                    <ThemedText style={styles.metaText} themeColor="textSecondary">
                      {progress.pct}% mastered
                    </ThemedText>

                    <View style={styles.shareRow}>
                      <Pressable
                        onPress={() => void handleWhatsApp(challengeShareText(challenge))}
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          { borderColor: theme.backgroundSelected },
                          pressed && { backgroundColor: theme.backgroundSelected },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Share ${challenge.title} on WhatsApp`}
                        testID="social-share-wa">
                        <Ionicons name="logo-whatsapp" size={18} color={whatsappColor} />
                        <ThemedText style={styles.secondaryBtnText}>WhatsApp</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleShareText(challengeShareText(challenge))}
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          { borderColor: theme.backgroundSelected },
                          pressed && { backgroundColor: theme.backgroundSelected },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Copy ${challenge.title} invite`}
                        testID={`social-copy-${challenge.id}`}>
                        <Ionicons name="copy-outline" size={17} color={theme.textSecondary} />
                        <ThemedText style={styles.secondaryBtnText}>Copy</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            {/* Completed / expired challenges */}
            {completedChallenges.length > 0 ? (
              <>
                <View style={styles.sectionHeader}>
                  <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                    COMPLETED
                  </ThemedText>
                  <ThemedText style={styles.sectionCount} themeColor="textSecondary">
                    {completedChallenges.length}
                  </ThemedText>
                </View>
                {completedChallenges.map((challenge) => {
                  const progress = challengeProgress(challenge, masteredCards);
                  return (
                    <View
                      key={challenge.id}
                      style={[styles.card, styles.completedCard, { backgroundColor: theme.backgroundElement }]}>
                      <View style={styles.challengeHeading}>
                        <ThemedText style={styles.challengeTitle} numberOfLines={2}>
                          {challenge.title}
                        </ThemedText>
                        <ThemedText style={styles.cardSubtitle} themeColor="textSecondary">
                          {challenge.code} · {progress.pct}% mastered
                        </ThemedText>
                      </View>
                      <Ionicons name="checkmark-done-circle" size={22} color={accent} />
                    </View>
                  );
                })}
              </>
            ) : null}

            {/* Share my progress */}
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHeading}>
                <View
                  style={[styles.cardIcon, { backgroundColor: isDark ? Brand.goldDark : Brand.goldSoft }]}>
                  <Ionicons name="sparkles-outline" size={18} color={isDark ? '#ffffff' : Brand.goldDark} />
                </View>
                <View style={styles.headingText}>
                  <ThemedText style={styles.cardTitle}>Share my progress</ThemedText>
                  <ThemedText style={styles.cardSubtitle} themeColor="textSecondary">
                    A snapshot of your journey — no account needed.
                  </ThemedText>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={[styles.stat, { backgroundColor: theme.background }]}>
                  <Ionicons name="flame" size={16} color={Brand.gold} />
                  <ThemedText style={styles.statValue}>{streakDays}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    day streak
                  </ThemedText>
                </View>
                <View style={[styles.stat, { backgroundColor: theme.background }]}>
                  <Ionicons name="star" size={16} color={Brand.gold} />
                  <ThemedText style={styles.statValue}>{xp.toLocaleString()}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    XP
                  </ThemedText>
                </View>
                <View style={[styles.stat, { backgroundColor: theme.background }]}>
                  <Ionicons name="book" size={16} color={accent} />
                  <ThemedText style={styles.statValue}>{masteredAyahs.toLocaleString()}</ThemedText>
                  <ThemedText style={styles.statLabel} themeColor="textSecondary">
                    ayahs
                  </ThemedText>
                </View>
              </View>

              <View style={styles.shareRow}>
                <Pressable
                  onPress={() => void handleWhatsApp(progressMessage)}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: theme.backgroundSelected },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Share my progress on WhatsApp"
                  testID="social-share-progress">
                  <Ionicons name="logo-whatsapp" size={18} color={whatsappColor} />
                  <ThemedText style={styles.secondaryBtnText}>WhatsApp</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void handleShareText(progressMessage)}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: theme.backgroundSelected },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy my progress card"
                  testID="social-copy-progress">
                  <Ionicons name="copy-outline" size={17} color={theme.textSecondary} />
                  <ThemedText style={styles.secondaryBtnText}>Copy</ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Invite a friend */}
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHeading}>
                <View style={[styles.cardIcon, { backgroundColor: softIconBg }]}>
                  <Ionicons name="person-add-outline" size={18} color={onSoftIcon} />
                </View>
                <View style={styles.headingText}>
                  <ThemedText style={styles.cardTitle}>Invite a friend</ThemedText>
                  <ThemedText style={styles.cardSubtitle} themeColor="textSecondary">
                    Send Muhafiz to someone starting their hifz journey.
                  </ThemedText>
                </View>
              </View>
              <View style={styles.shareRow}>
                <Pressable
                  onPress={() => void handleWhatsApp(appShareText())}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: theme.backgroundSelected },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Invite a friend on WhatsApp"
                  testID="social-invite-wa">
                  <Ionicons name="logo-whatsapp" size={18} color={whatsappColor} />
                  <ThemedText style={styles.secondaryBtnText}>WhatsApp</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void handleShareText(appShareText())}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: theme.backgroundSelected },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy app invite"
                  testID="social-invite-copy">
                  <Ionicons name="copy-outline" size={17} color={theme.textSecondary} />
                  <ThemedText style={styles.secondaryBtnText}>Copy</ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Join by code */}
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHeading}>
                <View style={[styles.cardIcon, { backgroundColor: softIconBg }]}>
                  <Ionicons name="key-outline" size={18} color={onSoftIcon} />
                </View>
                <View style={styles.headingText}>
                  <ThemedText style={styles.cardTitle}>Join with a code</ThemedText>
                  <ThemedText style={styles.cardSubtitle} themeColor="textSecondary">
                    Paste a friend&apos;s invite or type the 6-character code.
                  </ThemedText>
                </View>
              </View>

              <View style={styles.joinRow}>
                <TextInput
                  value={joinText}
                  onChangeText={(value) => {
                    setJoinText(value);
                    if (joinError) setJoinError(null);
                  }}
                  placeholder="Invite text or code"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    styles.joinInput,
                    {
                      color: theme.text,
                      backgroundColor: theme.background,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={320}
                  accessibilityLabel="Challenge code to join"
                  testID="social-join-input"
                  returnKeyType="done"
                  onSubmitEditing={() => void handleJoin()}
                />
                <Pressable
                  onPress={() => void handleJoin()}
                  disabled={joining}
                  style={({ pressed }) => [
                    styles.joinBtn,
                    { backgroundColor: buttonBg },
                    (pressed || joining) && styles.primaryBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Join challenge"
                  accessibilityState={{ disabled: joining, busy: joining }}
                  testID="social-join">
                  {joining ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <ThemedText style={styles.joinBtnText}>Join</ThemedText>
                  )}
                </Pressable>
              </View>

              {joinError ? (
                <ThemedText style={[styles.errorText, { color: errorColor }]}>{joinError}</ThemedText>
              ) : null}

              {joinedCode ? (
                <View
                  style={[
                    styles.joinedCard,
                    { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                  ]}>
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={isDark ? '#8FE8C7' : Brand.emeraldDark}
                  />
                  <View style={styles.joinedText}>
                    <ThemedText
                      style={[
                        styles.joinedTitle,
                        { color: isDark ? '#ffffff' : Brand.emeraldDark },
                      ]}>
                      Joined {joinedCode}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.joinedNote,
                        { color: isDark ? '#CDEDE3' : Brand.emeraldDark },
                      ]}>
                      Each friend tracks their own progress on their own device. Create a
                      challenge with the same surah range to compare.
                    </ThemedText>
                  </View>
                </View>
              ) : null}
            </View>

            <ThemedText style={styles.footNote} themeColor="textSecondary">
              Challenges are tracked on this device. Real-time groups and leaderboards come in a
              future update.
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 700 },
  headerRight: { width: 38 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
  },
  toastText: { fontSize: 13, fontWeight: 600 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  card: { borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  completedCard: {
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingText: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: 700 },
  cardSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  pickersRow: { flexDirection: 'row', gap: Spacing.two },
  stepperCard: { flex: 1, borderRadius: 14, padding: Spacing.two, gap: Spacing.one },
  stepperLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepperMiddle: { flex: 1, alignItems: 'center' },
  surahNumber: { fontSize: 18, fontWeight: 700, lineHeight: 22 },
  surahName: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  surahArabic: {
    fontFamily: 'Amiri',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 2,
  },
  daysCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    padding: Spacing.two,
  },
  daysValue: { fontSize: 18, fontWeight: 700, marginTop: 1 },
  daysControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  rangeSummary: { fontSize: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: Spacing.one,
  },
  primaryBtnPressed: { opacity: 0.8 },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: 700 },
  errorText: { fontSize: 12, lineHeight: 17 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2 },
  sectionCount: { fontSize: 11, fontWeight: 700 },
  emptyCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.four },
  emptyTitle: { fontSize: 15, fontWeight: 700, marginTop: Spacing.one },
  emptyText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  challengeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  challengeHeading: { flex: 1, gap: 2 },
  challengeTitle: { fontSize: 16, fontWeight: 700, lineHeight: 21 },
  codeChip: { borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  codeText: { fontSize: 12, fontWeight: 700, letterSpacing: 1.5 },
  progressMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 11, fontWeight: 600 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  shareRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: 600 },
  statsRow: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderRadius: 12, paddingVertical: Spacing.two, alignItems: 'center', gap: 1 },
  statValue: { fontSize: 16, fontWeight: 700 },
  statLabel: { fontSize: 10, fontWeight: 600 },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  joinInput: { flex: 1 },
  joinBtn: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnText: { color: '#ffffff', fontSize: 14, fontWeight: 700 },
  joinedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.two,
    marginTop: Spacing.one,
  },
  joinedText: { flex: 1, gap: 2 },
  joinedTitle: { fontSize: 14, fontWeight: 700 },
  joinedNote: { fontSize: 11, lineHeight: 16 },
  footNote: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
    marginTop: Spacing.one,
  },
});
