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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MushafText } from '@/components/mushaf-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { alignWords, type AlignResult } from '@/lib/align';
import { AsrError, transcribe, type RecordingInput } from '@/lib/asr';
import { ensureDb } from '@/lib/db';
import {
  applyGradingResult,
  buildGradingRequest,
  parseGradingResult,
} from '@/lib/grading-links';
import { useT } from '@/lib/i18n';
import { gradeAyahRange } from '@/lib/modes';
import { normalizeArabic, normalizeWord } from '@/lib/normalize-arabic';
import { ayahAudioUrl, getReciter, PLAYBACK_RATES } from '@/lib/reciters';
import { shareText, waLink, APP_URL } from '@/lib/share';
import { DAILY_ASR_QUOTA, localDateKey, useAsrStore } from '@/store/asr';
import { useSettings } from '@/store/settings';
import type { Rating } from '@/lib/xp';

const STREAM_WINDOW = 5;
const CHECKPOINT_MS = 8000;

const GRADES: { rating: Rating; label: string; color: string; testID: string }[] = [
  { rating: 1, label: 'Again', color: '#B3261E', testID: 'recite-grade-again' },
  { rating: 2, label: 'Hard', color: '#C9A227', testID: 'recite-grade-hard' },
  { rating: 3, label: 'Good', color: Brand.emerald, testID: 'recite-grade-good' },
  { rating: 4, label: 'Easy', color: Brand.emeraldDark, testID: 'recite-grade-easy' },
];

const LEGEND: { labelKey: string; verdict: AlignResult['words'][number]['verdict'] }[] = [
  { labelKey: 'recite.legend.correct', verdict: 'correct' },
  { labelKey: 'recite.legend.close', verdict: 'uncertain' },
  { labelKey: 'recite.legend.wrong', verdict: 'wrong' },
  { labelKey: 'recite.legend.missing', verdict: 'missing' },
  { labelKey: 'recite.legend.extra', verdict: 'extra' },
];

const VERDICT_COLORS: Record<string, string> = {
  correct: Brand.emerald,
  uncertain: '#C9A227',
  wrong: '#B3261E',
  missing: '#B3261E',
  extra: Brand.goldDark,
};

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function windowText(ayahs: { text_simple: string }[]): string {
  return ayahs.map((ayah) => ayah.text_simple).join(' ');
}

/**
 * Split an alignment over a concatenated ayah window back into per-ayah
 * buckets using each ayah's word count.
 */
function splitAlignmentByAyah(
  alignment: AlignResult,
  wordCounts: number[]
): { ayah: number; errorCount: number; correctCount: number }[] {
  const buckets: { ayah: number; errorCount: number; correctCount: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < wordCounts.length; i += 1) {
    const count = wordCounts[i];
    const slice = alignment.words.slice(cursor, cursor + count);
    cursor += count;
    let errorCount = 0;
    let correctCount = 0;
    for (const word of slice) {
      if (word.verdict === 'wrong' || word.verdict === 'missing') errorCount += 1;
      if (word.verdict === 'correct') correctCount += 1;
    }
    buckets.push({ ayah: i + 1, errorCount, correctCount });
  }
  return buckets;
}

export default function ReciteScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const t = useT();

  const { reciterId, playbackRate, fontScale, mushafTextColor, mushafParchment } = useSettings();
  const reciter = getReciter(reciterId);

  const groqKey = useAsrStore((state) => state.groqKey);
  const setGroqKey = useAsrStore((state) => state.setGroqKey);
  const quotaDate = useAsrStore((state) => state.quotaDate);
  const quotaUsedToday = useAsrStore((state) => state.quotaUsedToday);

  // Stream state
  const [surahNumber, setSurahNumber] = useState(1);
  const [fromAyah, setFromAyah] = useState(1);
  const [surah, setSurah] = useState<SurahData | null>(null);
  const [revealMode, setRevealMode] = useState(false); // false = see all lines
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set());
  const [selectedAyah, setSelectedAyah] = useState(1);

  // Recording + checking
  const [phase, setPhase] = useState<'idle' | 'starting' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<AlignResult | null>(null);
  const [perAyah, setPerAyah] = useState<{ ayah: number; errorCount: number; correctCount: number }[]>([]);

  // Grading
  const [graded, setGraded] = useState<Record<number, Rating>>({});
  const [grading, setGrading] = useState(false);
  const [keyModalVisible, setKeyModalVisible] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  // Live-checkpoint machinery.
  const windowAyahsRef = useRef<{ text_simple: string; number: number }[]>([]);
  const revealModeRef = useRef(revealMode);
  const checkpointBusyRef = useRef(false);
  const nativeTranscriptRef = useRef('');
  const fromAyahRef = useRef(fromAyah);

  const toAyah = Math.min(surah?.ayahCount ?? fromAyah + STREAM_WINDOW - 1, fromAyah + STREAM_WINDOW - 1);
  const toAyahRef = useRef(toAyah);

  useEffect(() => {
    revealModeRef.current = revealMode;
  }, [revealMode]);

  const windowAyahs = useMemo(() => {
    if (!surah) return [];
    return surah.ayahs.filter((a) => a.number >= fromAyah && a.number <= toAyah);
  }, [surah, fromAyah, toAyah]);

  useEffect(() => {
    windowAyahsRef.current = windowAyahs;
    fromAyahRef.current = fromAyah;
    toAyahRef.current = toAyah;
  }, [windowAyahs, fromAyah, toAyah]);

  const isRecording = recorderState.isRecording;
  const busy = phase !== 'idle';
  const checksToday = quotaDate === localDateKey() ? quotaUsedToday : 0;
  const quotaReached = checksToday >= DAILY_ASR_QUOTA;

  useEffect(() => {
    ensureDb().catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSurah(null);
    getSurah(surahNumber).then((data) => {
      if (cancelled) return;
      setSurah(data ?? null);
      if (data) {
        setFromAyah((current) => Math.min(Math.max(1, current), data.ayahCount));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [surahNumber]);

  // Reset per-stream state when the window moves.
  const resetStream = useCallback(() => {
    setResult(null);
    setTranscript(null);
    setError(null);
    setNotice(null);
    setGraded({});
    setPerAyah([]);
    setSelectedAyah(fromAyah);
    setRevealedSet(new Set());
  }, [fromAyah]);

  useEffect(() => {
    resetStream();
  }, [surahNumber, fromAyah, resetStream]);

  const playReciter = useCallback(() => {
    if (!surah) return;
    player.replace(ayahAudioUrl(reciter, surahNumber, selectedAyah));
    player.setPlaybackRate(playbackRate, 'high');
    player.play();
  }, [player, reciter, surahNumber, selectedAyah, playbackRate, surah]);

  const startRecording = async () => {
    resetStream();
    setPhase('starting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(t('recite.micNeeded'));
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
      setError(t('recite.micNeeded'));
    } finally {
      setPhase('idle');
    }
  };

  /**
   * Shared pipeline: normalize + align a transcript against the current
   * window, update the live word-check, and (in reveal mode) auto-reveal
   * the next line when the previous one is sufficiently covered.
   */
  const processTranscript = useCallback((heard: string) => {
    const window = windowAyahsRef.current;
    if (window.length === 0) return;
    const targetText = windowText(window);
    const targetWords = normalizeArabic(targetText).split(' ').filter(Boolean);
    const heardWords = normalizeArabic(heard).split(' ').filter(Boolean);
    const alignment = alignWords(targetWords, heardWords);
    const wordCounts = window.map((ayah) =>
      normalizeArabic(ayah.text_simple).split(' ').filter(Boolean).length
    );
    const perAyahBuckets = splitAlignmentByAyah(alignment, wordCounts);
    setTranscript(heard);
    setResult(alignment);
    setPerAyah(perAyahBuckets);

    // Reveal-as-you-go: when the last revealed line is mostly covered,
    // reveal the next hidden line automatically.
    if (revealModeRef.current) {
      const from = fromAyahRef.current;
      const to = toAyahRef.current;
      setRevealedSet((previous) => {
        let nextHidden = -1;
        for (let ayah = from + 1; ayah <= to; ayah += 1) {
          if (!previous.has(ayah)) {
            nextHidden = ayah;
            break;
          }
        }
        if (nextHidden === -1) return previous;
        const previousLine = nextHidden - 1;
        const bucket = perAyahBuckets.find((b) => b.ayah === previousLine);
        if (!bucket) return previous;
        const wordCount = window[previousLine - from] ? normalizeArabic(window[previousLine - from].text_simple).split(' ').filter(Boolean).length : 0;
        if (wordCount > 0 && (wordCount - bucket.errorCount) / wordCount >= 0.8) {
          return new Set(previous).add(nextHidden);
        }
        return previous;
      });
    }
  }, []);

  /** Live checkpoint: transcribe what has been recorded so far. */
  const runCheckpoint = useCallback(async () => {
    if (checkpointBusyRef.current) return;
    checkpointBusyRef.current = true;
    try {
      const window = windowAyahsRef.current;
      if (window.length === 0) return;
      if (Platform.OS === 'web') {
        const uri = recorder.uri;
        if (!uri) return;
        const blob = await (await fetch(uri)).blob();
        if (blob.size < 1000) return;
        const heard = await transcribe({ blob }, windowText(window));
        processTranscript(heard);
      } else {
        // Native: stop, transcribe the segment, immediately re-record.
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) {
          const heard = await transcribe(
            { uri, mimeType: 'audio/m4a' },
            windowText(window)
          );
          nativeTranscriptRef.current = nativeTranscriptRef.current
            ? `${nativeTranscriptRef.current} ${heard}`
            : heard;
          processTranscript(nativeTranscriptRef.current);
        }
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
    } catch {
      // Checkpoints are best-effort; quota/network errors surface on stop.
    } finally {
      checkpointBusyRef.current = false;
    }
  }, [processTranscript, recorder]);

  const runCheckpointRef = useRef(runCheckpoint);
  useEffect(() => {
    runCheckpointRef.current = runCheckpoint;
  }, [runCheckpoint]);

  // Live continuous checking: a checkpoint every ~8s while recording.
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      void runCheckpointRef.current();
    }, CHECKPOINT_MS);
    return () => clearInterval(timer);
  }, [isRecording]);

  const stopRecording = async () => {
    const durationMillis = recorderState.durationMillis;
    setPhase('transcribing');
    setError(null);
    try {
      await recorder.stop();
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        // ignore
      }
      if (durationMillis > 0 && durationMillis < 1200) {
        throw new AsrError('too-short', t('recite.tooShort'));
      }
      const uri = recorder.uri;
      if (!uri) throw new AsrError('too-short', t('recite.tooShort'));

      let recording: RecordingInput;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        recording = { blob };
      } else {
        recording = { uri, mimeType: 'audio/m4a' };
      }

      const heard = await transcribe(recording, windowText(windowAyahs));
      const finalText = Platform.OS === 'web' ? heard : nativeTranscriptRef.current
        ? `${nativeTranscriptRef.current} ${heard}`
        : heard;
      processTranscript(finalText);
      nativeTranscriptRef.current = '';
    } catch (caught) {
      setError(caught instanceof AsrError ? caught.message : t('recite.checkFailed'));
      setResult(null);
      setTranscript(null);
      setPerAyah([]);
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
    void startRecording();
  };

  const gradeSelected = async (rating: Rating) => {
    if (grading) return;
    setGrading(true);
    setError(null);
    try {
      const gradedResult = await gradeAyahRange(
        surahNumber,
        selectedAyah,
        selectedAyah,
        { [selectedAyah]: rating },
        'recite'
      );
      setGraded((previous) => ({ ...previous, [selectedAyah]: rating }));
      setNotice(t('recite.savedAs', { grade: GRADES.find((g) => g.rating === rating)?.label ?? 'Good', xp: gradedResult.xp }));
    } catch {
      setError(t('recite.saveFailed'));
    } finally {
      setGrading(false);
    }
  };

  const requestGrading = async () => {
    const seed = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01]/g, 'X');
    const text = buildGradingRequest(
      { surah: surahNumber, fromAyah, toAyah, seed },
      APP_URL
    );
    const result = await shareText(text);
    if (result.message) setFeedback(result.message);
  };

  const requestGradingWhatsApp = async () => {
    const seed = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01]/g, 'X');
    const text = buildGradingRequest(
      { surah: surahNumber, fromAyah, toAyah, seed },
      APP_URL
    );
    try {
      await Linking.openURL(waLink(text));
    } catch {
      await requestGrading();
    }
  };

  const applyPastedResult = async () => {
    const parsed = parseGradingResult(pasteText.trim());
    if (!parsed) {
      setError(t('grade.invalid'));
      return;
    }
    try {
      const applied = await applyGradingResult(parsed);
      setNotice(t('recite.resultApplied', { count: applied.count, xp: applied.xp }));
      setGraded((previous) => ({ ...previous, ...parsed.ratings }));
      setPasteOpen(false);
      setPasteText('');
    } catch {
      setError(t('recite.saveFailed'));
    }
  };

  const hiddenAyahs = useMemo(() => {
    if (!revealMode) return undefined;
    const hidden = new Set<number>();
    for (let ayah = fromAyah; ayah <= toAyah; ayah += 1) {
      if (ayah !== fromAyah && !revealedSet.has(ayah)) hidden.add(ayah);
    }
    return hidden;
  }, [revealMode, fromAyah, toAyah, revealedSet]);

  const recordDisabled = busy;
  const gradeDisabled = grading;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            testID="recite-back"
            style={[styles.iconButton, { borderColor: theme.backgroundSelected }]}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.title}>{t('recite.title')}</ThemedText>
          <Pressable
            onPress={() => setKeyModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('recite.groqKeyTitle')}
            testID="recite-settings"
            style={[styles.iconButton, { borderColor: theme.backgroundSelected }]}>
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
            <ThemedText type="small" style={{ color: isDark ? '#F0D98A' : Brand.goldDark, flex: 1 }}>
              {t('recite.beta')}
            </ThemedText>
          </View>

          {/* The stream itself */}
          {surah ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
                {t('recite.streamTitle')} — {surah.englishName}
              </ThemedText>
              <MushafText
                surah={surah}
                fromAyah={fromAyah}
                toAyah={toAyah}
                layout="flow"
                textColor={mushafTextColor}
                parchment={mushafParchment}
                fontScale={fontScale}
                currentAyah={selectedAyah}
                hiddenAyahs={hiddenAyahs}
                onAyahTap={(ayahNumber) => {
                  setSelectedAyah(ayahNumber);
                  if (hiddenAyahs?.has(ayahNumber)) {
                    setRevealedSet((previous) => new Set(previous).add(ayahNumber));
                  }
                }}
                testIDPrefix="recite-ayah"
              />
              <View style={styles.selectRow}>
                {windowAyahs.map((ayah) => (
                  <Pressable
                    key={ayah.number}
                    onPress={() => setSelectedAyah(ayah.number)}
                    style={[
                      styles.ayahSelectChip,
                      {
                        borderColor: selectedAyah === ayah.number ? Brand.emerald : theme.backgroundSelected,
                        backgroundColor: selectedAyah === ayah.number ? Brand.emerald : graded[ayah.number] ? Brand.goldSoft : 'transparent',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedAyah === ayah.number }}
                    testID={`recite-select-${ayah.number}`}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: selectedAyah === ayah.number ? '#fff' : graded[ayah.number] ? Brand.goldDark : theme.text }}>
                      {ayah.number}
                      {graded[ayah.number] ? ' ✓' : ''}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <ThemedText themeColor="textSecondary">{t('common.loading')}</ThemedText>
          )}

          {/* Record button below the text */}
          <View style={[styles.card, styles.recorderCard, { backgroundColor: theme.backgroundElement }]}>
            <Pressable
              onPress={onRecordPress}
              disabled={recordDisabled}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? t('recite.recording') : t('recite.record')}
              accessibilityState={{ disabled: recordDisabled, busy }}
              testID="recite-record"
              style={[styles.recordButton, isRecording && styles.recordButtonActive, { opacity: recordDisabled && !isRecording ? 0.45 : 1 }]}>
              {phase === 'transcribing' ? (
                <ActivityIndicator color="#ffffff" size="large" />
              ) : (
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={38} color="#ffffff" />
              )}
            </Pressable>
            <ThemedText type="smallBold" style={styles.recordHint}>
              {phase === 'starting'
                ? t('recite.preparing')
                : phase === 'transcribing'
                  ? t('recite.transcribing')
                  : isRecording
                    ? t('recite.recording')
                    : t('recite.record')}
            </ThemedText>
            {isRecording ? (
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(recorderState.durationMillis)}
              </ThemedText>
            ) : null}
            <View style={styles.quotaRow}>
              <Pressable
                onPress={() => setKeyModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={t('recite.groqKeyTitle')}
                testID="recite-key"
                style={styles.keyButton}>
                <Ionicons name={groqKey ? 'key' : 'key-outline'} size={14} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">
                  {groqKey ? t('recite.groqKeySaved') : t('recite.groqKey')}
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                {t('recite.quota', { used: checksToday, limit: DAILY_ASR_QUOTA })} ·{' '}
                {t('recite.liveNote')}
              </ThemedText>
            </View>
            {quotaReached ? (
              <ThemedText type="small" style={{ color: isDark ? '#F0D98A' : Brand.goldDark }}>
                {t('recite.quotaReached')}
              </ThemedText>
            ) : null}
          </View>

          {error ? (
            <View style={[styles.errorCard, { backgroundColor: isDark ? '#3A1D1A' : '#FDECEA' }]}>
              <Ionicons name="alert-circle" size={18} color="#B3261E" />
              <ThemedText type="small" style={{ color: isDark ? '#FFB4AB' : '#B3261E', flex: 1 }}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          {/* Word check result */}
          {result ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
                {t('recite.wordCheck')}
              </ThemedText>
              <View style={styles.scoreRow}>
                <View>
                  <ThemedText style={[styles.scoreValue, { color: isDark ? '#3DD9A8' : Brand.emerald }]}>
                    {Math.round(result.score * 100)}%
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('recite.wordMatch')}
                  </ThemedText>
                </View>
                <View style={styles.scoreRight}>
                  <ThemedText style={[styles.scoreValue, { color: isDark ? '#E2C15A' : Brand.goldDark }]}>
                    {Math.round(result.coverage * 100)}%
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('recite.coverage')}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.perAyahRow}>
                {perAyah.map((entry) => (
                  <ThemedText key={entry.ayah} type="small" themeColor="textSecondary">
                    {entry.ayah}: {entry.errorCount === 0 ? '✓' : `${entry.errorCount}✗`}
                  </ThemedText>
                ))}
              </View>
              <View style={[styles.heardPanel, { backgroundColor: theme.background }]}>
                <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
                  {t('recite.weHeard')}
                </ThemedText>
                <ThemedText style={styles.heardText}>{transcript || '—'}</ThemedText>
              </View>
              <Pressable
                onPress={playReciter}
                accessibilityRole="button"
                accessibilityLabel={t('mushaf.replay')}
                style={[styles.secondaryButton, { borderColor: theme.backgroundSelected }]}>
                <Ionicons name="volume-high-outline" size={18} color={theme.text} />
                <ThemedText type="smallBold">{t('mushaf.replay')}</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {/* Self-grade for the selected ayah */}
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
              {t('recite.selfGrade')} — {t('common.ayah')} {selectedAyah}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('recite.selfGradeHint')}
            </ThemedText>
            <View style={styles.gradeRow}>
              {GRADES.map((grade) => {
                const selected = graded[selectedAyah] === grade.rating;
                return (
                  <Pressable
                    key={grade.rating}
                    onPress={() => void gradeSelected(grade.rating)}
                    disabled={gradeDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('common.ayah')} ${selectedAyah}: ${grade.label}`}
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
                    <ThemedText type="smallBold" style={{ color: selected ? '#ffffff' : grade.color }}>
                      {grade.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {notice ? (
              <ThemedText type="small" style={{ color: Brand.emerald }}>
                {notice}
              </ThemedText>
            ) : null}
            {feedback ? (
              <ThemedText type="small" style={{ color: Brand.teal }}>
                {feedback}
              </ThemedText>
            ) : null}
          </View>

          {/* Shared grading */}
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.stepperLabel} themeColor="textSecondary">
              {t('recite.requestGrade')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('recite.requestGradeHint')}
            </ThemedText>
            <View style={styles.shareRow}>
              <Pressable
                onPress={() => void requestGradingWhatsApp()}
                style={[styles.secondaryButton, { borderColor: theme.backgroundSelected, flex: 1 }]}
                accessibilityRole="button"
                accessibilityLabel={t('recite.requestGradeBtn')}
                testID="recite-request-grade">
                <Ionicons name="logo-whatsapp" size={16} color={Brand.emerald} />
                <ThemedText type="smallBold">{t('recite.requestGradeBtn')}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setPasteOpen(true)}
                style={[styles.secondaryButton, { borderColor: theme.backgroundSelected, flex: 1 }]}
                accessibilityRole="button"
                accessibilityLabel={t('recite.pasteResult')}
                testID="recite-paste-result">
                <Ionicons name="clipboard-outline" size={16} color={Brand.teal} />
                <ThemedText type="smallBold">{t('recite.pasteResult')}</ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={styles.betaFooter}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.betaFooterTitle}>
              {t('recite.beta')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.betaFooterText}>
              {t('recite.betaFooter')}
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Settings panel: stream controls + Groq key */}
      <Modal visible={keyModalVisible} transparent animationType="fade" onRequestClose={() => setKeyModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {t('common.settings')}
              </ThemedText>

              {/* Start ayah */}
              <ThemedText style={styles.modalLabel} themeColor="textSecondary">
                {t('recite.startAyah')}
              </ThemedText>
              <View style={styles.stepperControls}>
                <Pressable
                  onPress={() => setFromAyah((current) => Math.max(1, current - STREAM_WINDOW))}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Previous block"
                  style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
                  <Ionicons name="remove" size={16} color={theme.text} />
                </Pressable>
                <ThemedText style={styles.stepValue} testID="recite-start-value">
                  {fromAyah}–{toAyah}
                </ThemedText>
                <Pressable
                  onPress={() =>
                    setFromAyah((current) =>
                      Math.min(Math.max(1, (surah?.ayahCount ?? 1) - STREAM_WINDOW + 1), current + STREAM_WINDOW)
                    )
                  }
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Next block"
                  style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
                  <Ionicons name="add" size={16} color={theme.text} />
                </Pressable>
              </View>

              {/* Reveal mode */}
              <ThemedText style={styles.modalLabel} themeColor="textSecondary">
                {t('recite.streamTitle')}
              </ThemedText>
              <Pressable
                onPress={() => {
                  setRevealMode(!revealMode);
                  setRevealedSet(new Set());
                }}
                style={[
                  styles.modeChip,
                  {
                    borderColor: revealMode ? Brand.gold : theme.backgroundSelected,
                    backgroundColor: revealMode ? Brand.goldSoft : 'transparent',
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: revealMode }}
                testID="recite-reveal-mode">
                <Ionicons
                  name={revealMode ? 'eye-outline' : 'eye-off-outline'}
                  size={14}
                  color={revealMode ? Brand.goldDark : theme.text}
                />
                <ThemedText type="smallBold" style={{ color: revealMode ? Brand.goldDark : theme.text }}>
                  {revealMode ? t('recite.revealMode') : t('recite.seeAll')}
                </ThemedText>
              </Pressable>
              {revealMode ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('recite.revealHint')}
                </ThemedText>
              ) : null}

              {/* Playback speed */}
              <ThemedText style={styles.modalLabel} themeColor="textSecondary">
                {t('onboarding.speed')}
              </ThemedText>
              <View style={styles.optionRow}>
                {PLAYBACK_RATES.map((rate) => (
                  <Pressable
                    key={rate}
                    onPress={() => useSettings.getState().setPlaybackRate(rate)}
                    style={[
                      styles.speedChip,
                      {
                        borderColor: playbackRate === rate ? Brand.emerald : theme.backgroundSelected,
                        backgroundColor: playbackRate === rate ? Brand.emeraldSoft : 'transparent',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: playbackRate === rate }}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: playbackRate === rate ? Brand.emeraldDark : theme.text }}>
                      {rate}×
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              {/* Groq key */}
              <ThemedText type="smallBold" style={styles.modalLabel}>
                {t('recite.groqKeyTitle')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('recite.groqKeyBody')}
              </ThemedText>
              <TextInput
                value={keyDraft}
                onChangeText={setKeyDraft}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="gsk_..."
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel={t('recite.groqKeyTitle')}
                testID="recite-groq-input"
                style={[styles.keyInput, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              <View style={styles.modalActions}>
                {groqKey ? (
                  <Pressable
                    onPress={() => {
                      setGroqKey('');
                      setKeyDraft('');
                      setKeyModalVisible(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.remove')}
                    testID="recite-groq-remove"
                    style={styles.modalTextButton}>
                    <ThemedText type="smallBold" style={{ color: '#B3261E' }}>
                      {t('common.remove')}
                    </ThemedText>
                  </Pressable>
                ) : null}
                <View style={styles.modalSpacer} />
                <Pressable
                  onPress={() => setKeyModalVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                  style={styles.modalTextButton}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('common.cancel')}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setGroqKey(keyDraft);
                    setKeyModalVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.save')}
                  testID="recite-groq-save"
                  style={styles.modalSaveButton}>
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                    {t('common.save')}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Paste grading result modal */}
      <Modal visible={pasteOpen} transparent animationType="fade" onRequestClose={() => setPasteOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {t('recite.pasteResult')}
              </ThemedText>
              <TextInput
                value={pasteText}
                onChangeText={setPasteText}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                placeholder={t('recite.pasteResultPlaceholder')}
                placeholderTextColor={theme.textSecondary}
                style={[styles.keyInput, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected, minHeight: 80, textAlignVertical: 'top' }]}
                testID="recite-paste-input"
              />
              <View style={styles.modalActions}>
                <View style={styles.modalSpacer} />
                <Pressable
                  onPress={() => setPasteOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                  style={styles.modalTextButton}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('common.cancel')}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void applyPastedResult()}
                  accessibilityRole="button"
                  accessibilityLabel={t('recite.applyResult')}
                  testID="recite-apply-result"
                  style={styles.modalSaveButton}>
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                    {t('recite.applyResult')}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  iconButton: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: 700, flex: 1, textAlign: 'center' },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  betaBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  streamControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  stepperGroup: { gap: Spacing.one },
  stepperLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 16, fontWeight: 700, minWidth: 60, textAlign: 'center' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  ayahSelectChip: { minWidth: 44, alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  recorderCard: { alignItems: 'center' },
  recordButton: { width: 92, height: 92, borderRadius: 46, backgroundColor: Brand.emerald, alignItems: 'center', justifyContent: 'center' },
  recordButtonActive: { backgroundColor: '#B3261E' },
  recordHint: { textAlign: 'center' },
  quotaRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  keyButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  scoreRight: { alignItems: 'flex-end' },
  scoreValue: { fontSize: 36, fontWeight: 800, lineHeight: 40 },
  perAyahRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  heardPanel: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  heardText: { fontFamily: 'Amiri', fontSize: 18, lineHeight: 30, textAlign: 'right', writingDirection: 'rtl' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  gradeRow: { flexDirection: 'row', gap: Spacing.two },
  gradeButton: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: Spacing.two },
  shareRow: { flexDirection: 'row', gap: Spacing.two },
  betaFooter: { gap: Spacing.one, paddingHorizontal: Spacing.two },
  betaFooterTitle: { textAlign: 'center' },
  betaFooterText: { textAlign: 'center', fontSize: 11, lineHeight: 16 },
  modalRoot: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'center', padding: Spacing.four },
  modalCard: { borderRadius: 18, padding: Spacing.four, gap: Spacing.three },
  modalTitle: { fontSize: 24, lineHeight: 30 },
  modalLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, marginTop: Spacing.two },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  speedChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  keyInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modalSpacer: { flex: 1 },
  modalTextButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  modalSaveButton: { backgroundColor: Brand.emerald, borderRadius: 10, paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
});
