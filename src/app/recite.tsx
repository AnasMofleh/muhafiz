import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { alignWords, type AlignedWord, type AlignResult } from '@/lib/align';
import { AsrError, transcribe, type RecordingInput } from '@/lib/asr';
import { ensureDb, getCardsForSurah, getDueCards, getOrCreateCard } from '@/lib/db';
import { gradeCardReview } from '@/lib/modes';
import { normalizeArabic, normalizeWord } from '@/lib/normalize-arabic';
import { ayahAudioUrl, getReciter } from '@/lib/reciters';
import { unitKeyFor } from '@/lib/scheduler';
import type { Rating } from '@/lib/xp';
import { DAILY_ASR_QUOTA, localDateKey, useAsrStore } from '@/store/asr';
import { useSettings } from '@/store/settings';

type Phase = 'idle' | 'starting' | 'transcribing';

const VERDICT_COLORS: Record<AlignedWord['verdict'], string> = {
  correct: '#0E7A5F',
  uncertain: '#C9A227',
  wrong: '#B3261E',
  missing: '#B3261E',
  extra: '#7A5F10',
};

const GRADES: { rating: Rating; label: string; color: string; testID: string }[] = [
  { rating: 1, label: 'Again', color: '#B3261E', testID: 'recite-grade-again' },
  { rating: 2, label: 'Hard', color: '#C9A227', testID: 'recite-grade-hard' },
  { rating: 3, label: 'Good', color: '#0E7A5F', testID: 'recite-grade-good' },
  { rating: 4, label: 'Easy', color: '#0A5C47', testID: 'recite-grade-easy' },
];

const LEGEND: { label: string; verdict: AlignedWord['verdict'] }[] = [
  { label: 'Correct', verdict: 'correct' },
  { label: 'Close', verdict: 'uncertain' },
  { label: 'Wrong', verdict: 'wrong' },
  { label: 'Missing', verdict: 'missing' },
  { label: 'Extra', verdict: 'extra' },
];

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function targetWordsFor(textSimple: string): string[] {
  const normalized = normalizeArabic(textSimple);
  if (normalized) return normalized.split(' ').filter(Boolean);

  // Fatiha 1 is the basmala itself, which normalizeArabic strips. Fall back to
  // the word-level normalization so the target is never empty.
  return textSimple
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

function heardWordsFor(transcript: string, textSimple: string): string[] {
  const normalized = normalizeArabic(transcript);
  if (normalized) return normalized.split(' ').filter(Boolean);

  // Keep the basmala when the target ayah is the basmala itself.
  if (normalizeArabic(textSimple) === '') {
    return transcript
      .split(/\s+/)
      .map(normalizeWord)
      .filter(Boolean);
  }

  return [];
}

function gradeLabel(rating: Rating): string {
  return GRADES.find((grade) => grade.rating === rating)?.label ?? 'Good';
}

interface StepperProps {
  label: string;
  value: number;
  disabled: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseTestID: string;
  increaseTestID: string;
  onDecrease: () => void;
  onIncrease: () => void;
}

function Stepper({
  label,
  value,
  disabled,
  decreaseLabel,
  increaseLabel,
  decreaseTestID,
  increaseTestID,
  onDecrease,
  onIncrease,
}: StepperProps) {
  const theme = useTheme();

  return (
    <View style={styles.stepperGroup}>
      <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={onDecrease}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={decreaseLabel}
          accessibilityState={{ disabled }}
          testID={decreaseTestID}
          style={[
            styles.stepButton,
            { borderColor: theme.backgroundSelected, opacity: disabled ? 0.4 : 1 },
          ]}>
          <Ionicons name="remove" size={18} color={theme.text} />
        </Pressable>
        <ThemedText style={styles.stepValue}>{value}</ThemedText>
        <Pressable
          onPress={onIncrease}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={increaseLabel}
          accessibilityState={{ disabled }}
          testID={increaseTestID}
          style={[
            styles.stepButton,
            { borderColor: theme.backgroundSelected, opacity: disabled ? 0.4 : 1 },
          ]}>
          <Ionicons name="add" size={18} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}

export default function ReciteScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();

  const reciterId = useSettings((state) => state.reciterId);
  const playbackRate = useSettings((state) => state.playbackRate);
  const fontScale = useSettings((state) => state.fontScale);

  const groqKey = useAsrStore((state) => state.groqKey);
  const setGroqKey = useAsrStore((state) => state.setGroqKey);
  const quotaDate = useAsrStore((state) => state.quotaDate);
  const quotaUsedToday = useAsrStore((state) => state.quotaUsedToday);
  const setLastResult = useAsrStore((state) => state.setLastResult);

  const [surahNumber, setSurahNumber] = useState(1);
  const [ayahNumber, setAyahNumber] = useState(1);
  const [surahData, setSurahData] = useState<SurahData | null>(null);
  const [loadingSurah, setLoadingSurah] = useState(true);
  const [dueLoading, setDueLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<AlignResult | null>(null);
  const [graded, setGraded] = useState<{ rating: Rating; xp: number } | null>(null);
  const [grading, setGrading] = useState(false);
  const [keyModalVisible, setKeyModalVisible] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const targetAyah = useMemo(
    () => surahData?.ayahs.find((ayah) => ayah.number === ayahNumber) ?? null,
    [surahData, ayahNumber]
  );

  const isRecording = recorderState.isRecording;
  const busy = phase !== 'idle';
  const checksToday = quotaDate === localDateKey() ? quotaUsedToday : 0;
  const quotaReached = checksToday >= DAILY_ASR_QUOTA;
  const reciter = getReciter(reciterId);

  useEffect(() => {
    ensureDb().catch(() => {
      // The recorder and self-grade paths surface database errors when used.
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingSurah(true);

    getSurah(surahNumber)
      .then((data) => {
        if (cancelled) return;
        setSurahData(data ?? null);
        if (data) {
          setAyahNumber((current) => Math.min(Math.max(1, current), data.ayahCount));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSurahData(null);
        setError('Could not load this surah. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSurah(false);
      });

    return () => {
      cancelled = true;
    };
  }, [surahNumber]);

  const resetOutput = useCallback(() => {
    setResult(null);
    setTranscript(null);
    setGraded(null);
    setError(null);
    setNotice(null);
  }, []);

  const playReciter = useCallback(() => {
    if (!targetAyah) return;

    player.replace(ayahAudioUrl(reciter, surahNumber, ayahNumber));
    player.setPlaybackRate(playbackRate);
    player.play();
  }, [player, reciter, surahNumber, ayahNumber, playbackRate, targetAyah]);

  const changeSurah = (delta: number) => {
    if (isRecording || busy) return;
    resetOutput();
    setSurahNumber((current) => Math.min(114, Math.max(1, current + delta)));
    setAyahNumber(1);
  };

  const changeAyah = (delta: number) => {
    if (!surahData || isRecording || busy) return;
    resetOutput();
    setAyahNumber((current) => Math.min(surahData.ayahCount, Math.max(1, current + delta)));
  };

  const useDueAyah = async () => {
    if (isRecording || busy || dueLoading) return;

    setDueLoading(true);
    resetOutput();

    try {
      const dueCards = await getDueCards(Date.now());
      const card = dueCards[0];

      if (!card) {
        setNotice('Nothing is due right now. Pick a surah and ayah above, or create a plan on the Today screen.');
        return;
      }

      setSurahNumber(card.surah);
      setAyahNumber(card.startAyah);
    } catch {
      setError('Could not read your due queue. Please try again.');
    } finally {
      setDueLoading(false);
    }
  };

  const startRecording = async () => {
    resetOutput();
    setPhase('starting');

    try {
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        setError('Microphone access is needed to check your recitation.');
        return;
      }

      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      } catch {
        // Audio-mode configuration is best effort on web.
      }

      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setError('Could not start recording. Please try again.');
    } finally {
      setPhase('idle');
    }
  };

  const stopRecording = async () => {
    const durationMillis = recorderState.durationMillis;
    const ayah = targetAyah;

    setPhase('transcribing');
    setError(null);

    try {
      await recorder.stop();

      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        // ignore
      }

      if (!ayah) {
        setError('The ayah text is still loading. Please try again.');
        return;
      }

      if (durationMillis > 0 && durationMillis < 1200) {
        throw new AsrError('too-short', 'Recording too short');
      }

      const uri = recorder.uri;
      if (!uri) {
        throw new AsrError('too-short', 'Recording too short');
      }

      let recording: RecordingInput;

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        recording = { blob };
      } else {
        recording = { uri, mimeType: 'audio/m4a' };
      }

      const heard = await transcribe(recording, ayah.text_uthmani);
      const targetWords = targetWordsFor(ayah.text_simple);
      const heardWords = heardWordsFor(heard, ayah.text_simple);
      const alignment = alignWords(targetWords, heardWords);

      setTranscript(heard);
      setResult(alignment);
      setGraded(null);
      setLastResult({
        surah: surahNumber,
        ayah: ayahNumber,
        words: alignment.words,
        score: alignment.score,
      });
    } catch (caught) {
      if (caught instanceof AsrError) {
        setError(caught.message);
      } else if (caught instanceof Error && caught.message === 'Recording too short') {
        setError(caught.message);
      } else {
        setError('Could not check the recording. Please try again.');
      }
      setResult(null);
      setTranscript(null);
    } finally {
      setPhase('idle');
    }
  };

  const onRecordPress = () => {
    if (busy) return;

    if (isRecording) {
      void stopRecording();
      return;
    }

    if (!targetAyah) {
      setError('The ayah text is still loading. Please try again.');
      return;
    }

    void startRecording();
  };

  const gradeResult = async (rating: Rating) => {
    if (graded || grading) return;

    setGrading(true);
    setError(null);

    const errorCount = result
      ? result.words.filter(
          (word) => word.verdict === 'wrong' || word.verdict === 'missing'
        ).length
      : 0;

    try {
      await ensureDb();
      // Canonical grading path: schedule the card covering this ayah with FSRS
      // (creating one when this ayah has no card yet), so recite reviews land
      // in the same due queue as the practice modes.
      const cards = await getCardsForSurah(surahNumber);
      let card = cards.find((c) => c.startAyah <= ayahNumber && c.endAyah >= ayahNumber);
      if (!card) {
        card = await getOrCreateCard(unitKeyFor(surahNumber, ayahNumber, ayahNumber));
      }
      const gradedResult = await gradeCardReview({ card, rating, mode: 'recite', errorCount });
      setGraded({ rating, xp: gradedResult.xp });
    } catch {
      setError('Could not save your grade. Please try again.');
    } finally {
      setGrading(false);
    }
  };

  const nextAyah = () => {
    if (isRecording || busy) return;

    resetOutput();

    if (surahData && ayahNumber < surahData.ayahCount) {
      setAyahNumber(ayahNumber + 1);
      return;
    }

    if (surahNumber < 114) {
      setSurahNumber(surahNumber + 1);
      setAyahNumber(1);
      return;
    }

    setSurahNumber(1);
    setAyahNumber(1);
  };

  const openKeyModal = () => {
    setKeyDraft(groqKey);
    setKeyModalVisible(true);
  };

  const saveKey = () => {
    setGroqKey(keyDraft);
    setKeyModalVisible(false);
  };

  const removeKey = () => {
    setGroqKey('');
    setKeyDraft('');
    setKeyModalVisible(false);
  };

  const recordDisabled = busy || !targetAyah;
  const gradeDisabled = Boolean(graded) || grading;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="recite-back"
            style={[styles.iconButton, { borderColor: theme.backgroundSelected }]}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.title}>Recite &amp; Check</ThemedText>
          <Pressable
            onPress={openKeyModal}
            accessibilityRole="button"
            accessibilityLabel="Transcription settings"
            testID="recite-settings"
            style={[styles.iconButton, { borderColor: theme.backgroundSelected }]}>
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.betaBanner,
              {
                backgroundColor: isDark ? '#3A2F12' : Brand.goldSoft,
                borderColor: isDark ? Brand.goldDark : Brand.gold,
              },
            ]}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={isDark ? '#F0D98A' : Brand.goldDark}
            />
            <ThemedText
              type="small"
              style={{ color: isDark ? '#F0D98A' : Brand.goldDark, flex: 1 }}>
              Word check (beta) — practice aid, not a tajweed teacher
            </ThemedText>
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.selectorHeader}>
              <View style={styles.selectorHeading}>
                <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                  AYAH TO CHECK
                </ThemedText>
                <ThemedText type="smallBold">
                  {surahData
                    ? `${surahData.englishName} · ${surahData.name}`
                    : `Surah ${surahNumber}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {surahData ? `${surahData.ayahCount} ayahs` : 'Loading…'}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => void useDueAyah()}
                disabled={isRecording || busy || dueLoading}
                accessibilityRole="button"
                accessibilityLabel="Use today's due ayah"
                accessibilityState={{ disabled: isRecording || busy || dueLoading, busy: dueLoading }}
                testID="recite-use-due"
                style={[
                  styles.dueButton,
                  {
                    borderColor: Brand.emerald,
                    opacity: isRecording || busy || dueLoading ? 0.5 : 1,
                  },
                ]}>
                {dueLoading ? (
                  <ActivityIndicator size="small" color={Brand.emerald} />
                ) : (
                  <Ionicons name="today-outline" size={15} color={Brand.emerald} />
                )}
                <ThemedText type="smallBold" style={{ color: Brand.emerald }}>
                  Due ayah
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.stepperRow}>
              <Stepper
                label="SURAH"
                value={surahNumber}
                disabled={isRecording || busy}
                decreaseLabel="Previous surah"
                increaseLabel="Next surah"
                decreaseTestID="recite-surah-prev"
                increaseTestID="recite-surah-next"
                onDecrease={() => changeSurah(-1)}
                onIncrease={() => changeSurah(1)}
              />
              <Stepper
                label="AYAH"
                value={ayahNumber}
                disabled={isRecording || busy || !surahData}
                decreaseLabel="Previous ayah"
                increaseLabel="Next ayah selection"
                decreaseTestID="recite-ayah-prev"
                increaseTestID="recite-ayah-next"
                onDecrease={() => changeAyah(-1)}
                onIncrease={() => changeAyah(1)}
              />
            </View>

            {notice ? (
              <ThemedText type="small" style={{ color: Brand.emerald }}>
                {notice}
              </ThemedText>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.targetHeader}>
              <View style={styles.selectorHeading}>
                <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                  TARGET AYAH
                </ThemedText>
                <ThemedText type="smallBold">
                  Surah {surahNumber} · Ayah {ayahNumber}
                </ThemedText>
              </View>
              <Pressable
                onPress={playReciter}
                disabled={!targetAyah || isRecording || busy}
                accessibilityRole="button"
                accessibilityLabel="Play reciter"
                accessibilityState={{ disabled: !targetAyah || isRecording || busy }}
                testID="recite-play"
                style={[
                  styles.playButton,
                  { opacity: !targetAyah || isRecording || busy ? 0.5 : 1 },
                ]}>
                <Ionicons name="play" size={15} color="#ffffff" />
                <ThemedText type="smallBold" style={styles.playButtonText}>
                  Play
                </ThemedText>
              </Pressable>
            </View>

            {loadingSurah ? (
              <View style={styles.loadingAyah}>
                <ActivityIndicator color={Brand.emerald} />
              </View>
            ) : targetAyah ? (
              <ThemedText
                style={[
                  styles.arabicText,
                  { fontSize: 28 * fontScale, lineHeight: 48 * fontScale },
                ]}>
                {targetAyah.text_uthmani}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                This ayah could not be loaded.
              </ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary">
              {reciter.name} · {playbackRate}×
            </ThemedText>
          </View>

          <View style={[styles.card, styles.recorderCard, { backgroundColor: theme.backgroundElement }]}>
            <Pressable
              onPress={onRecordPress}
              disabled={recordDisabled}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
              accessibilityState={{ disabled: recordDisabled, busy }}
              testID="recite-record"
              style={[
                styles.recordButton,
                isRecording && styles.recordButtonActive,
                { opacity: recordDisabled && !isRecording ? 0.45 : 1 },
              ]}>
              {phase === 'transcribing' ? (
                <ActivityIndicator color="#ffffff" size="large" />
              ) : (
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={38} color="#ffffff" />
              )}
            </Pressable>

            <ThemedText type="smallBold" style={styles.recordHint}>
              {phase === 'starting'
                ? 'Preparing microphone…'
                : phase === 'transcribing'
                  ? 'Checking your recitation…'
                  : isRecording
                    ? 'Listening — tap to stop'
                    : 'Tap to record this ayah'}
            </ThemedText>

            {isRecording ? (
              <View style={styles.recordingRow}>
                <View style={styles.recordingDot} />
                <ThemedText type="small" themeColor="textSecondary">
                  Recording {formatDuration(recorderState.durationMillis)}
                </ThemedText>
              </View>
            ) : null}

            <View style={styles.quotaRow}>
              <Pressable
                onPress={openKeyModal}
                accessibilityRole="button"
                accessibilityLabel="Open transcription settings"
                testID="recite-key"
                style={styles.keyButton}>
                <Ionicons
                  name={groqKey ? 'key' : 'key-outline'}
                  size={14}
                  color={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {groqKey ? 'Groq key saved' : 'Add Groq API key'}
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                {checksToday}/{DAILY_ASR_QUOTA} checks today
              </ThemedText>
            </View>

            {quotaReached ? (
              <ThemedText
                type="small"
                style={{ color: isDark ? '#F0D98A' : Brand.goldDark }}>
                Daily Groq check limit reached. Self-grade below still works, or try again
                tomorrow.
              </ThemedText>
            ) : null}
          </View>

          {error ? (
            <View style={[styles.errorCard, { backgroundColor: isDark ? '#3A1D1A' : '#FDECEA' }]}>
              <Ionicons name="alert-circle" size={18} color="#B3261E" />
              <ThemedText
                type="small"
                style={{ color: isDark ? '#FFB4AB' : '#B3261E', flex: 1 }}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          {result ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                WORD CHECK
              </ThemedText>

              <View style={styles.scoreRow}>
                <View>
                  <ThemedText
                    style={[
                      styles.scoreValue,
                      { color: isDark ? '#3DD9A8' : Brand.emerald },
                    ]}>
                    {Math.round(result.score * 100)}%
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    word match
                  </ThemedText>
                </View>
                <View style={styles.scoreRight}>
                  <ThemedText
                    style={[
                      styles.scoreValue,
                      { color: isDark ? '#E2C15A' : Brand.goldDark },
                    ]}>
                    {Math.round(result.coverage * 100)}%
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    coverage
                  </ThemedText>
                </View>
              </View>

              <View style={styles.wordsWrap}>
                {result.words.map((word, index) => (
                  <View
                    key={`${word.text}-${index}`}
                    style={[
                      styles.wordChip,
                      word.verdict === 'missing' && {
                        borderWidth: 1,
                        borderColor: VERDICT_COLORS.missing,
                      },
                      word.verdict === 'extra' && {
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: VERDICT_COLORS.extra,
                      },
                    ]}>
                    <ThemedText
                      style={[styles.wordText, { color: VERDICT_COLORS[word.verdict] }]}>
                      {word.text}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <View style={styles.legendRow}>
                {LEGEND.map((item) => (
                  <View key={item.verdict} style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: VERDICT_COLORS[item.verdict] },
                      ]}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.label}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <View style={[styles.heardPanel, { backgroundColor: theme.background }]}>
                <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                  WE HEARD
                </ThemedText>
                <ThemedText style={styles.heardText}>{transcript || '—'}</ThemedText>
              </View>

              <Pressable
                onPress={playReciter}
                accessibilityRole="button"
                accessibilityLabel="Replay reciter"
                testID="recite-replay"
                style={[styles.secondaryButton, { borderColor: theme.backgroundSelected }]}>
                <Ionicons name="volume-high-outline" size={18} color={theme.text} />
                <ThemedText type="smallBold">Replay reciter</ThemedText>
              </Pressable>

              <View style={styles.actionsRow}>
                <Pressable
                  onPress={playReciter}
                  accessibilityRole="button"
                  accessibilityLabel="Play ayah again"
                  testID="recite-play-again"
                  style={[styles.secondaryButton, { borderColor: theme.backgroundSelected }]}>
                  <Ionicons name="play" size={18} color={theme.text} />
                  <ThemedText type="smallBold">Replay</ThemedText>
                </Pressable>
                <Pressable
                  onPress={nextAyah}
                  accessibilityRole="button"
                  accessibilityLabel="Next ayah"
                  testID="recite-next"
                  style={styles.primaryButton}>
                  <ThemedText type="smallBold" style={styles.primaryButtonText}>
                    Next ayah
                  </ThemedText>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Self-grade lives outside the result gate: it must stay available
              when ASR is unavailable (no key, quota reached, no mic support). */}
          {targetAyah ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.gradeSection}>
                <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                  SELF-GRADE
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Grades schedule this ayah even when speech checking is unavailable.
                </ThemedText>

                <View style={styles.gradeRow}>
                  {GRADES.map((grade) => {
                    const selected = graded?.rating === grade.rating;

                    return (
                      <Pressable
                        key={grade.rating}
                        onPress={() => void gradeResult(grade.rating)}
                        disabled={gradeDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={`Grade ${grade.label}`}
                        accessibilityState={{ disabled: gradeDisabled, selected }}
                        testID={grade.testID}
                        style={[
                          styles.gradeButton,
                          {
                            borderColor: grade.color,
                            backgroundColor: selected ? grade.color : 'transparent',
                            opacity: gradeDisabled && !selected ? 0.5 : 1,
                          },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={{ color: selected ? '#ffffff' : grade.color }}>
                          {grade.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                {graded ? (
                  <ThemedText
                    type="small"
                    style={{ color: isDark ? '#3DD9A8' : Brand.emerald }}>
                    Saved as {gradeLabel(graded.rating)} · +{graded.xp} XP
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.betaFooter}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.betaFooterTitle}>
              Word check (beta) — practice aid, not a tajweed teacher
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.betaFooterText}>
              This checks which words were heard against the Hafs text. It does not detect
              tajweed, madd, or ghunnah. Use the self-grade buttons to keep your review
              schedule moving.
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={keyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setKeyModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                Groq API key
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Used for Whisper transcription of your recitation. The key is stored only on
                this device. Create a free key at console.groq.com.
              </ThemedText>
              <TextInput
                value={keyDraft}
                onChangeText={setKeyDraft}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="gsk_..."
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Groq API key"
                testID="recite-groq-input"
                style={[
                  styles.keyInput,
                  {
                    backgroundColor: theme.backgroundElement,
                    color: theme.text,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
              <View style={styles.modalActions}>
                {groqKey ? (
                  <Pressable
                    onPress={removeKey}
                    accessibilityRole="button"
                    accessibilityLabel="Remove Groq API key"
                    testID="recite-groq-remove"
                    style={styles.modalTextButton}>
                    <ThemedText type="smallBold" style={{ color: '#B3261E' }}>
                      Remove
                    </ThemedText>
                  </Pressable>
                ) : null}
                <View style={styles.modalSpacer} />
                <Pressable
                  onPress={() => setKeyModalVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  style={styles.modalTextButton}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Cancel
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={saveKey}
                  accessibilityRole="button"
                  accessibilityLabel="Save Groq API key"
                  testID="recite-groq-save"
                  style={styles.modalSaveButton}>
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                    Save
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  iconButton: {
    padding: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
  title: { fontSize: 20, fontWeight: 700, flex: 1, textAlign: 'center' },
  scroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  betaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  selectorHeading: { flex: 1 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  stepperGroup: { flex: 1, gap: Spacing.two },
  stepperLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    fontSize: 18,
    fontWeight: 700,
    minWidth: 44,
    textAlign: 'center',
  },
  dueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Brand.emerald,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  playButtonText: { color: '#ffffff' },
  loadingAyah: { paddingVertical: Spacing.four, alignItems: 'center' },
  arabicText: {
    fontFamily: 'Amiri',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  recorderCard: { alignItems: 'center' },
  recordButton: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: Brand.emerald,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: { backgroundColor: '#B3261E' },
  recordHint: { textAlign: 'center' },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#B3261E',
  },
  quotaRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  keyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  scoreRight: { alignItems: 'flex-end' },
  scoreValue: { fontSize: 36, fontWeight: 800, lineHeight: 40 },
  wordsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  wordChip: {
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  wordText: {
    fontFamily: 'Amiri',
    fontSize: 24,
    lineHeight: 38,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  heardPanel: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  heardText: {
    fontFamily: 'Amiri',
    fontSize: 18,
    lineHeight: 30,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Brand.emerald,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  primaryButtonText: { color: '#ffffff' },
  gradeSection: { gap: Spacing.two },
  gradeRow: { flexDirection: 'row', gap: Spacing.two },
  gradeButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  betaFooter: { gap: Spacing.one, paddingHorizontal: Spacing.two },
  betaFooterTitle: { textAlign: 'center' },
  betaFooterText: { textAlign: 'center', fontSize: 11, lineHeight: 16 },
  modalRoot: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalTitle: { fontSize: 24, lineHeight: 30 },
  keyInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modalSpacer: { flex: 1 },
  modalTextButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  modalSaveButton: {
    backgroundColor: Brand.emerald,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
});
