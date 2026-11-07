import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getIndex } from '@/data/quran';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { createPlan } from '@/lib/db';
import { PLAYBACK_RATES, RECITERS } from '@/lib/reciters';
import { useSettings } from '@/store/settings';

type GoalMode = 'surahs' | 'juz' | 'quran';
type Step = 1 | 2 | 3 | 4;

const PRAYER_ANCHORS = ['Fajr', 'Asr', 'Maghrib', 'Isha', 'None'] as const;
const DAYS_OPTIONS = [3, 5, 7] as const;
const TOTAL_STEPS = 4;

export default function OnboardingScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();
  const index = useMemo(() => getIndex(), []);
  const settings = useSettings();

  const [step, setStep] = useState<Step>(1);
  const [goalMode, setGoalMode] = useState<GoalMode>('surahs');
  const [selectedSurahs, setSelectedSurahs] = useState<number[]>([]);
  const [juzFrom, setJuzFrom] = useState(1);
  const [juzTo, setJuzTo] = useState(1);
  const [dailyNew, setDailyNew] = useState(5);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [prayerAnchor, setPrayerAnchor] = useState<string>('Fajr');
  const addDoomscrollTime = () => {
    const trimmed = doomscrollDraft.trim();
    if (!trimmed) return;
    setDoomscrollTimes((previous) => [...previous, trimmed]);
    setDoomscrollDraft('');
  };

  const removeDoomscrollTime = (idx: number) => {
    setDoomscrollTimes((previous) => previous.filter((_, i) => i !== idx));
  };

  const [doomscrollTimes, setDoomscrollTimes] = useState<string[]>([]);
  const [doomscrollDraft, setDoomscrollDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accent = isDark ? '#43D6A3' : Brand.emerald;
  const selectedChipBg = isDark ? Brand.emeraldDark : Brand.emeraldSoft;
  const selectedChipText = isDark ? '#ffffff' : Brand.emeraldDark;

  const toggleSurah = (number: number) => {
    setSelectedSurahs((prev) =>
      prev.includes(number) ? prev.filter((n) => n !== number) : [...prev, number].sort((a, b) => a - b)
    );
  };

  const setJuzFromSafe = (value: number) => {
    const next = Math.min(30, Math.max(1, value));
    setJuzFrom(next);
    if (next > juzTo) setJuzTo(next);
  };

  const setJuzToSafe = (value: number) => {
    const next = Math.min(30, Math.max(1, value));
    setJuzTo(next);
    if (next < juzFrom) setJuzFrom(next);
  };

  const step1Valid =
    goalMode === 'quran' ||
    (goalMode === 'surahs' && selectedSurahs.length > 0) ||
    (goalMode === 'juz' && juzFrom <= juzTo);

  const goalSummary = useMemo(() => {
    if (goalMode === 'quran') return 'The whole Quran · 6,236 ayahs';
    if (goalMode === 'juz') return `Juz ${juzFrom}${juzTo !== juzFrom ? `–${juzTo}` : ''}`;
    if (selectedSurahs.length === 0) return 'No surahs selected';
    const names = selectedSurahs
      .slice(0, 3)
      .map((n) => index.surahs[n - 1]?.englishName ?? `Surah ${n}`)
      .join(', ');
    return `${selectedSurahs.length} ${selectedSurahs.length === 1 ? 'surah' : 'surahs'} · ${names}${
      selectedSurahs.length > 3 ? '…' : ''
    }`;
  }, [goalMode, juzFrom, juzTo, selectedSurahs, index]);

  const goBack = () => {
    if (step === 1) {
      router.back();
    } else {
      setStep((s) => (s - 1) as Step);
    }
  };

  const onNext = () => {
    if (step < TOTAL_STEPS) {
      setStep((s) => (s + 1) as Step);
    }
  };

  const onFinish = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await createPlan({
        kind: goalMode,
        surahs: goalMode === 'surahs' ? selectedSurahs : [],
        juzFrom,
        juzTo,
        dailyNew,
        daysPerWeek,
        prayerAnchor: prayerAnchor.toLowerCase(),
        doomscroll: JSON.stringify(doomscrollTimes),
        reciterId: settings.reciterId,
      });
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your plan.');
      setSaving(false);
    }
  };

  const optionStyle = (selected: boolean) => [
    {
      backgroundColor: selected ? selectedChipBg : 'transparent',
      borderColor: selected ? accent : theme.backgroundSelected,
    },
  ];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="onboarding-back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Create your plan</ThemedText>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.progressRow}>
          {[1, 2, 3, 4].map((n) => (
            <View
              key={n}
              style={[
                styles.progressDot,
                {
                  backgroundColor: n <= step ? accent : theme.backgroundSelected,
                  flex: n === step ? 2 : 1,
                },
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <ThemedText style={styles.stepLabel} themeColor="textSecondary">
            {t('onboarding.stepOf', { step })}
          </ThemedText>

          {step === 1 && (
            <>
              <ThemedText style={styles.title}>{t('onboarding.step1Title')}</ThemedText>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                {t('onboarding.step1Body')}
              </ThemedText>

              <View style={styles.segmentRow}>
                {(
                  [
                    { key: 'surahs', label: t('onboarding.surahs') },
                    { key: 'juz', label: t('onboarding.juzRange') },
                    { key: 'quran', label: t('onboarding.wholeQuran') },
                  ] as { key: GoalMode; label: string }[]
                ).map((option) => (
                  <Pressable
                    key={option.key}
                    onPress={() => setGoalMode(option.key)}
                    style={[styles.segment, optionStyle(goalMode === option.key)]}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: goalMode === option.key }}
                    testID={`goal-${option.key}`}>
                    <ThemedText
                      style={[
                        styles.segmentText,
                        goalMode === option.key && { color: selectedChipText },
                      ]}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              {goalMode === 'surahs' && (
                <>
                  <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                    SELECT SURAHS · {selectedSurahs.length} SELECTED
                  </ThemedText>
                  <View style={styles.surahGrid}>
                    {index.surahs.map((surah) => {
                      const selected = selectedSurahs.includes(surah.number);
                      return (
                        <Pressable
                          key={surah.number}
                          onPress={() => toggleSurah(surah.number)}
                          style={[
                            styles.surahCell,
                            {
                              backgroundColor: selected
                                ? isDark
                                  ? Brand.emeraldDark
                                  : Brand.emerald
                                : theme.backgroundElement,
                              borderColor: selected ? accent : 'transparent',
                            },
                          ]}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Surah ${surah.englishName}`}
                          accessibilityState={{ checked: selected }}
                          testID={`surah-pick-${surah.number}`}>
                          <ThemedText
                            style={[styles.surahNumber, selected && styles.surahNumberSelected]}>
                            {surah.number}
                          </ThemedText>
                          <ThemedText
                            numberOfLines={1}
                            style={[styles.surahName, selected && styles.surahNameSelected]}>
                            {surah.englishName}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {goalMode === 'juz' && (
                <>
                  <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                    JUZ RANGE
                  </ThemedText>
                  <View style={[styles.stepperCard, { backgroundColor: theme.backgroundElement }]}>
                    <View style={styles.stepperRow}>
                      <ThemedText style={styles.stepperLabel}>From Juz</ThemedText>
                      <View style={styles.stepperControls}>
                        <Pressable
                          onPress={() => setJuzFromSafe(juzFrom - 1)}
                          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                          accessibilityRole="button"
                          accessibilityLabel="Previous starting juz">
                          <Ionicons name="remove" size={18} color={theme.text} />
                        </Pressable>
                        <ThemedText style={styles.stepperValue}>{juzFrom}</ThemedText>
                        <Pressable
                          onPress={() => setJuzFromSafe(juzFrom + 1)}
                          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                          accessibilityRole="button"
                          accessibilityLabel="Next starting juz">
                          <Ionicons name="add" size={18} color={theme.text} />
                        </Pressable>
                      </View>
                    </View>
                    <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
                    <View style={styles.stepperRow}>
                      <ThemedText style={styles.stepperLabel}>To Juz</ThemedText>
                      <View style={styles.stepperControls}>
                        <Pressable
                          onPress={() => setJuzToSafe(juzTo - 1)}
                          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                          accessibilityRole="button"
                          accessibilityLabel="Previous ending juz">
                          <Ionicons name="remove" size={18} color={theme.text} />
                        </Pressable>
                        <ThemedText style={styles.stepperValue}>{juzTo}</ThemedText>
                        <Pressable
                          onPress={() => setJuzToSafe(juzTo + 1)}
                          style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
                          accessibilityRole="button"
                          accessibilityLabel="Next ending juz">
                          <Ionicons name="add" size={18} color={theme.text} />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                  <ThemedText style={styles.helper} themeColor="textSecondary">
                    You&apos;ll memorize through Juz {juzFrom}
                    {juzTo !== juzFrom ? ` to ${juzTo}` : ''}, one chunk at a time.
                  </ThemedText>
                </>
              )}

              {goalMode === 'quran' && (
                <View style={[styles.summaryCard, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="earth-outline" size={28} color={accent} />
                  <ThemedText style={styles.summaryTitle}>{t('onboarding.wholeQuranTitle')}</ThemedText>
                  <ThemedText style={styles.helper} themeColor="textSecondary">
                    {t('onboarding.wholeQuranDesc')}
                  </ThemedText>
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <ThemedText style={styles.title}>How much can you handle daily?</ThemedText>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                Be honest — consistency beats intensity.
              </ThemedText>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                NEW AYAHS PER DAY
              </ThemedText>
              <View style={[styles.stepperCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.bigStepperRow}>
                  <Pressable
                    onPress={() => setDailyNew((n) => Math.max(1, n - 1))}
                    style={[styles.bigStepBtn, { borderColor: theme.backgroundSelected }]}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease daily ayahs">
                    <Ionicons name="remove" size={24} color={theme.text} />
                  </Pressable>
                  <View style={styles.bigValueWrap}>
                    <ThemedText style={styles.bigValue}>{dailyNew}</ThemedText>
                    <ThemedText style={styles.bigValueLabel} themeColor="textSecondary">
                      ayahs / day
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => setDailyNew((n) => Math.min(15, n + 1))}
                    style={[styles.bigStepBtn, { borderColor: theme.backgroundSelected }]}
                    accessibilityRole="button"
                    accessibilityLabel="Increase daily ayahs">
                    <Ionicons name="add" size={24} color={theme.text} />
                  </Pressable>
                </View>
              </View>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                Roughly {Math.ceil(dailyNew / 6)} chunk{Math.ceil(dailyNew / 6) === 1 ? '' : 's'} a
                day, including a little revision.
              </ThemedText>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                DAYS PER WEEK
              </ThemedText>
              <View style={styles.segmentRow}>
                {DAYS_OPTIONS.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setDaysPerWeek(n)}
                    style={[styles.segment, optionStyle(daysPerWeek === n)]}
                    accessibilityRole="radio"
                    accessibilityLabel={`${n} days per week`}
                    accessibilityState={{ selected: daysPerWeek === n }}>
                    <ThemedText
                      style={[styles.segmentText, daysPerWeek === n && { color: selectedChipText }]}>
                      {n} days
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                With a rest day, your reviews still come due — we spread them gently.
              </ThemedText>
            </>
          )}

          {step === 3 && (
            <>
              <ThemedText style={styles.title}>When does practice fit?</ThemedText>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                Anchor your session to something that already happens every day.
              </ThemedText>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                PRAYER ANCHOR
              </ThemedText>
              <View style={styles.chipWrap}>
                {PRAYER_ANCHORS.map((anchor) => {
                  const selected = prayerAnchor === anchor;
                  return (
                    <Pressable
                      key={anchor}
                      onPress={() => setPrayerAnchor(anchor)}
                      style={[styles.chip, optionStyle(selected)]}
                      accessibilityRole="radio"
                      accessibilityLabel={anchor}
                      accessibilityState={{ selected }}>
                      <ThemedText
                        style={[styles.chipText, selected && { color: selectedChipText }]}>
                        {anchor}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                WHEN DO YOU USUALLY DOOMSCROLL?
              </ThemedText>
              {/* Multiple times can be added; stored as a JSON array. */}
              <View style={styles.doomRow}>
                <TextInput
                  value={doomscrollDraft}
                  onChangeText={setDoomscrollDraft}
                  placeholder="e.g. in bed, on the bus, after Isha"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.textInput,
                    styles.doomInput,
                    { backgroundColor: theme.backgroundElement, color: theme.text },
                  ]}
                  accessibilityLabel="Add a doomscroll time"
                  testID="onboarding-doomscroll"
                />
                <Pressable
                  onPress={addDoomscrollTime}
                  disabled={!doomscrollDraft.trim()}
                  style={[
                    styles.doomAddBtn,
                    { backgroundColor: Brand.teal, opacity: doomscrollDraft.trim() ? 1 : 0.4 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Add time"
                  testID="onboarding-doomscroll-add">
                  <Ionicons name="add" size={18} color="#fff" />
                </Pressable>
              </View>
              {doomscrollTimes.length > 0 ? (
                <View style={styles.doomChips}>
                  {doomscrollTimes.map((timeEntry, idx) => (
                    <View
                      key={`${timeEntry}-${idx}`}
                      style={[styles.doomChip, { backgroundColor: Brand.tealSoft }]}>
                      <ThemedText type="smallBold" style={{ color: Brand.teal }}>
                        {timeEntry}
                      </ThemedText>
                      <Pressable
                        onPress={() => removeDoomscrollTime(idx)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${timeEntry}`}
                        testID={`onboarding-doomscroll-remove-${idx}`}>
                        <Ionicons name="close" size={14} color={Brand.teal} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <ThemedText style={styles.helper} themeColor="textSecondary">
                We&apos;ll suggest swapping that scroll for a 5-minute review.
              </ThemedText>
            </>
          )}

          {step === 4 && (
            <>
              <ThemedText style={styles.title}>Choose your reciter</ThemedText>
              <ThemedText style={styles.helper} themeColor="textSecondary">
                You can change this any time in Settings.
              </ThemedText>

              <View style={styles.reciterList}>
                {RECITERS.map((reciter) => {
                  const selected = reciter.id === settings.reciterId;
                  return (
                    <Pressable
                      key={reciter.id}
                      onPress={() => settings.setReciter(reciter.id)}
                      style={[
                        styles.reciterRow,
                        {
                          backgroundColor: selected ? selectedChipBg : theme.backgroundElement,
                          borderColor: selected ? accent : 'transparent',
                        },
                      ]}
                      accessibilityRole="radio"
                      accessibilityLabel={reciter.name}
                      accessibilityState={{ selected }}
                      testID={`reciter-${reciter.id}`}>
                      <View style={styles.reciterText}>
                        <ThemedText style={styles.reciterName}>{reciter.name}</ThemedText>
                        {reciter.note ? (
                          <ThemedText style={styles.reciterNote} themeColor="textSecondary">
                            {reciter.note}
                          </ThemedText>
                        ) : null}
                      </View>
                      {selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                SPEED PREVIEW
              </ThemedText>
              <View style={styles.chipWrap}>
                {PLAYBACK_RATES.map((rate) => {
                  const selected = rate === settings.playbackRate;
                  return (
                    <Pressable
                      key={rate}
                      onPress={() => settings.setPlaybackRate(rate)}
                      style={[styles.chip, optionStyle(selected)]}
                      accessibilityRole="radio"
                      accessibilityLabel={`${rate} times speed`}
                      accessibilityState={{ selected }}>
                      <ThemedText
                        style={[styles.chipText, selected && { color: selectedChipText }]}>
                        {rate}×
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
                YOUR PLAN
              </ThemedText>
              <View style={[styles.summaryCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel} themeColor="textSecondary">
                    Goal
                  </ThemedText>
                  <ThemedText style={styles.summaryValue}>{goalSummary}</ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel} themeColor="textSecondary">
                    Pace
                  </ThemedText>
                  <ThemedText style={styles.summaryValue}>
                    {dailyNew} ayahs · {daysPerWeek} days/week
                  </ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel} themeColor="textSecondary">
                    Anchor
                  </ThemedText>
                  <ThemedText style={styles.summaryValue}>{prayerAnchor}</ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel} themeColor="textSecondary">
                    Reciter
                  </ThemedText>
                  <ThemedText style={styles.summaryValue}>
                    {RECITERS.find((r) => r.id === settings.reciterId)?.name ?? 'Al-Husary'}
                  </ThemedText>
                </View>
              </View>

              {error ? (
                <ThemedText style={[styles.errorText, { color: '#C0392B' }]}>{error}</ThemedText>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.backgroundSelected }]}>
          {step < TOTAL_STEPS ? (
            <Pressable
              onPress={onNext}
              disabled={step === 1 && !step1Valid}
              style={({ pressed }) => [
                styles.nextBtn,
                { backgroundColor: Brand.emerald },
                (step === 1 && !step1Valid) && styles.disabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Next step"
              accessibilityState={{ disabled: step === 1 && !step1Valid }}
              testID="onboarding-next">
              <ThemedText style={styles.nextBtnText}>{t('common.continue')}</ThemedText>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void onFinish()}
              disabled={saving}
              style={({ pressed }) => [
                styles.nextBtn,
                { backgroundColor: Brand.emerald },
                saving && styles.disabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Finish and create plan"
              accessibilityState={{ disabled: saving }}
              testID="onboarding-finish">
              <ThemedText style={styles.nextBtnText}>
                {saving ? 'Creating…' : 'Start memorizing'}
              </ThemedText>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </Pressable>
          )}
        </View>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700 },
  headerRight: { width: 38 },
  progressRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  progressDot: { height: 4, borderRadius: 2 },
  scroll: { flex: 1 },
  body: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  stepLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2 },
  title: { fontSize: 26, fontWeight: 700, lineHeight: 32 },
  helper: { fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginTop: Spacing.three },
  segmentRow: { flexDirection: 'row', gap: Spacing.two },
  segment: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: 600 },
  surahGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  surahCell: {
    flexBasis: '15%',
    flexGrow: 1,
    borderRadius: 10,
    paddingVertical: Spacing.one,
    paddingHorizontal: 2,
    alignItems: 'center',
    borderWidth: 1,
  },
  surahNumber: { fontSize: 13, fontWeight: 700 },
  surahNumberSelected: { color: '#fff' },
  surahName: { fontSize: 9, marginTop: 1, maxWidth: '100%' },
  surahNameSelected: { color: '#fff' },
  stepperCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperLabel: { fontSize: 15, fontWeight: 600 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { fontSize: 22, fontWeight: 700, minWidth: 34, textAlign: 'center' },
  divider: { height: 1 },
  bigStepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  bigStepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigValueWrap: { alignItems: 'center' },
  bigValue: { fontSize: 44, fontWeight: 700, lineHeight: 50 },
  bigValueLabel: { fontSize: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipText: { fontSize: 13, fontWeight: 600 },
  doomRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  doomInput: { flex: 1 },
  doomAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  doomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  textInput: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 15,
  },
  reciterList: { gap: Spacing.two },
  reciterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
  },
  reciterText: { flex: 1 },
  reciterName: { fontSize: 15, fontWeight: 600 },
  reciterNote: { fontSize: 12, marginTop: 1 },
  summaryCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  summaryRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  summaryLabel: { fontSize: 12, fontWeight: 600, width: 64 },
  summaryValue: { fontSize: 14, fontWeight: 600, flex: 1 },
  summaryTitle: { fontSize: 18, fontWeight: 700, textAlign: 'center' },
  errorText: { fontSize: 13, marginTop: Spacing.two },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    borderTopWidth: 1,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 15,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: 700 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
