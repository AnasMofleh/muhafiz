import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { AyahRef } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { checkBadges, describeBadges, getBadgeState } from '@/lib/badges';
import {
  gradeCardReview,
  gradeErrorMapping,
  nextAyahRef,
  pickDueCard,
  type CardRow,
} from '@/lib/modes';
import { useT } from '@/lib/i18n';
import { loadSectionQueue, shuffle } from '@/lib/practice-queue';
import { useSettings } from '@/store/settings';
import { useAyahAudio } from '@/lib/use-ayah-audio';
import { PracticeOptions } from '@/components/practice-options';

type IconName = ComponentProps<typeof Ionicons>['name'];
type QuizType = 'next' | 'blank' | 'order' | 'listen';

const QUIZ_TYPES: { key: QuizType; label: string; icon: IconName }[] = [
  { key: 'next', label: 'Next Ayah', icon: 'play-circle-outline' },
  { key: 'blank', label: 'Fill Blank', icon: 'text-outline' },
  { key: 'order', label: 'Ordering', icon: 'list-outline' },
  { key: 'listen', label: 'Listening', icon: 'headset-outline' },
];

const QUESTION_COUNT = 6;

interface PoolAyah {
  surah: number;
  ayah: number;
  uthmani: string;
  simple: string;
  /** Owning FSRS card key ('' for distractor-only seed ayahs). */
  cardKey: string;
}

interface NextQuestion {
  kind: 'next';
  prompt: string;
  options: string[];
  correctIndex: number;
  audio: AyahRef;
  source: string;
  cardKey: string;
}

interface BlankQuestion {
  kind: 'blank';
  masked: string;
  options: string[];
  correctIndex: number;
  fullText: string;
  source: string;
  cardKey: string;
}

interface OrderQuestion {
  kind: 'order';
  items: { ayah: number; text: string }[];
  answer: number[];
  source: string;
  cardKey: string;
}

interface ListenQuestion {
  kind: 'listen';
  options: string[];
  correctIndex: number;
  audio: AyahRef;
  source: string;
  cardKey: string;
}

type Question = NextQuestion | BlankQuestion | OrderQuestion | ListenQuestion;

// ---------------------------------------------------------------------------
// Question generation
// ---------------------------------------------------------------------------

function uniqueTexts(texts: string[], exclude: string[], count: number): string[] {
  const seen = new Set(exclude);
  const result: string[] = [];
  for (const text of shuffle(texts)) {
    const clean = text.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= count) break;
  }
  return result;
}

function refKey(ref: AyahRef): string {
  return `${ref.surah}:${ref.ayah}`;
}

async function buildPool(cards: CardRow[]): Promise<PoolAyah[]> {
  const surahNumbers = [...new Set(cards.map((card) => card.surah))].slice(0, 5);
  const pool: PoolAyah[] = [];

  for (const number of surahNumbers) {
    const surah = await getSurah(number);
    if (!surah) continue;
    for (const ayah of surah.ayahs) {
      const owner = cards.find(
        (card) =>
          card.surah === number && card.startAyah <= ayah.number && card.endAyah >= ayah.number
      );
      pool.push({
        surah: number,
        ayah: ayah.number,
        uthmani: ayah.text_uthmani,
        simple: ayah.text_simple,
        cardKey: owner?.unitKey ?? '',
      });
    }
  }

  // A tiny queue (or a single short surah) still deserves a full set of
  // options, so seed with Al-Fatiha when the pool is thin.
  if (pool.length < 12) {
    const fatiha = await getSurah(1);
    if (fatiha) {
      for (const ayah of fatiha.ayahs) {
        if (!pool.some((item) => item.surah === 1 && item.ayah === ayah.number)) {
          pool.push({
            surah: 1,
            ayah: ayah.number,
            uthmani: ayah.text_uthmani,
            simple: ayah.text_simple,
            cardKey: '',
          });
        }
      }
    }
  }

  return pool;
}

function buildNextQuestions(pool: PoolAyah[]): NextQuestion[] {
  const byRef = new Map(pool.map((item) => [refKey(item), item]));
  const candidates = shuffle(
    pool.filter((item) => {
      const next = nextAyahRef(item);
      return next !== null && byRef.has(refKey(next));
    })
  );
  const allTexts = pool.map((item) => item.uthmani);
  const questions: NextQuestion[] = [];
  const used = new Set<string>();

  for (const item of candidates) {
    if (questions.length >= QUESTION_COUNT) break;
    const key = refKey(item);
    if (used.has(key)) continue;
    const nextRef = nextAyahRef(item);
    if (!nextRef) continue;
    const next = byRef.get(refKey(nextRef));
    if (!next) continue;
    const distractors = uniqueTexts(allTexts, [next.uthmani, item.uthmani], 3);
    if (distractors.length < 3) continue;

    used.add(key);
    const options = shuffle([next.uthmani, ...distractors]);
    questions.push({
      kind: 'next',
      prompt: item.uthmani,
      options,
      correctIndex: options.indexOf(next.uthmani),
      audio: { surah: item.surah, ayah: item.ayah },
      source: key,
      cardKey: item.cardKey,
    });
  }

  return questions;
}

function buildBlankQuestions(pool: PoolAyah[]): BlankQuestion[] {
  const candidates = shuffle(
    pool.filter((item) => item.uthmani.split(/\s+/).filter(Boolean).length >= 3)
  );
  const allWords = pool.flatMap((item) =>
    item.uthmani.split(/\s+/).filter((word) => word.length > 1)
  );
  const questions: BlankQuestion[] = [];
  const used = new Set<string>();

  for (const item of candidates) {
    if (questions.length >= QUESTION_COUNT) break;
    const key = refKey(item);
    if (used.has(key)) continue;

    const words = item.uthmani.split(/\s+/).filter(Boolean);
    if (words.length < 3) continue;
    const wordIndex = Math.floor(Math.random() * words.length);
    const answer = words[wordIndex];
    const distractors = uniqueTexts(allWords, [answer], 3);
    if (distractors.length < 3) continue;

    used.add(key);
    const maskedWords = [...words];
    maskedWords[wordIndex] = '____';
    const options = shuffle([answer, ...distractors]);

    questions.push({
      kind: 'blank',
      masked: maskedWords.join(' '),
      options,
      correctIndex: options.indexOf(answer),
      fullText: item.uthmani,
      source: key,
      cardKey: item.cardKey,
    });
  }

  return questions;
}

function buildOrderQuestions(pool: PoolAyah[]): OrderQuestion[] {
  const bySurah = new Map<number, PoolAyah[]>();
  for (const item of pool) {
    const list = bySurah.get(item.surah);
    if (list) list.push(item);
    else bySurah.set(item.surah, [item]);
  }

  const questions: OrderQuestion[] = [];
  const usedSegments = new Set<string>();

  for (const surahNumber of shuffle([...bySurah.keys()])) {
    if (questions.length >= 4) break;
    const ayahs = bySurah.get(surahNumber);
    if (!ayahs) continue;
    const sorted = [...ayahs].sort((a, b) => a.ayah - b.ayah);
    if (sorted.length < 4) continue;

    const length = Math.min(5, sorted.length);
    for (let attempt = 0; attempt < 8 && questions.length < 4; attempt += 1) {
      const start = Math.floor(Math.random() * (sorted.length - length + 1));
      const segment = sorted.slice(start, start + length);
      const signature = `${surahNumber}:${segment[0].ayah}-${segment[segment.length - 1].ayah}`;
      if (usedSegments.has(signature)) continue;
      usedSegments.add(signature);

      questions.push({
        kind: 'order',
        items: shuffle(
          segment.map((item) => ({ ayah: item.ayah, text: item.uthmani }))
        ),
        answer: segment.map((item) => item.ayah),
        source: signature,
        cardKey: segment[0]?.cardKey ?? '',
      });
    }
  }

  return questions;
}

function buildListenQuestions(pool: PoolAyah[]): ListenQuestion[] {
  const byRef = new Map(pool.map((item) => [refKey(item), item]));
  const candidates = shuffle(
    pool.filter((item) => {
      const next = nextAyahRef(item);
      return next !== null && byRef.has(refKey(next));
    })
  );

  const nextTexts: string[] = [];
  for (const candidate of candidates) {
    const next = nextAyahRef(candidate);
    if (!next) continue;
    const item = byRef.get(refKey(next));
    if (item) nextTexts.push(item.uthmani);
  }

  const questions: ListenQuestion[] = [];
  const used = new Set<string>();

  for (const item of candidates) {
    if (questions.length >= QUESTION_COUNT) break;
    const key = refKey(item);
    if (used.has(key)) continue;
    const next = nextAyahRef(item);
    if (!next) continue;
    const nextItem = byRef.get(refKey(next));
    if (!nextItem) continue;

    const distractors = uniqueTexts(nextTexts, [nextItem.uthmani], 3);
    if (distractors.length < 3) continue;

    used.add(key);
    const options = shuffle([nextItem.uthmani, ...distractors]);
    questions.push({
      kind: 'listen',
      options,
      correctIndex: options.indexOf(nextItem.uthmani),
      audio: { surah: item.surah, ayah: item.ayah },
      source: key,
      cardKey: item.cardKey,
    });
  }

  return questions;
}

function buildQuestions(type: QuizType, pool: PoolAyah[]): Question[] {
  if (pool.length < 5) return [];
  switch (type) {
    case 'next':
      return buildNextQuestions(pool);
    case 'blank':
      return buildBlankQuestions(pool);
    case 'order':
      return buildOrderQuestions(pool);
    case 'listen':
      return buildListenQuestions(pool);
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function QuizScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { playAyah, playing } = useAyahAudio();
  const { flashcardSection, flashcardSurah, flashcardJuz, flashcardRandom } = useSettings();

  const [cards, setCards] = useState<CardRow[]>([]);
  const [pool, setPool] = useState<PoolAyah[]>([]);
  const [type, setType] = useState<QuizType>('next');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [errors, setErrors] = useState(0);
  const [questionErrors, setQuestionErrors] = useState(0);
  const [orderPicks, setOrderPicks] = useState<number[]>([]);
  const [orderWrong, setOrderWrong] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-card answered/error counts, so every quizzed card is graded with its
  // own error rate instead of one aggregate grade on an arbitrary card.
  const [answeredByCard, setAnsweredByCard] = useState<Record<string, { answered: number; errors: number }>>({});

  const bumpCardStat = useCallback((cardKey: string, errorsDelta: number, answeredDelta = 0) => {
    if (!cardKey) return;
    setAnsweredByCard((previous) => {
      const entry = previous[cardKey] ?? { answered: 0, errors: 0 };
      return {
        ...previous,
        [cardKey]: {
          answered: entry.answered + answeredDelta,
          errors: entry.errors + errorsDelta,
        },
      };
    });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Same section/order settings as Flashcards.
        const { flashcardSection, flashcardSurah, flashcardJuz, flashcardRandom } =
          useSettings.getState();
        let loaded = await loadSectionQueue(flashcardSection, flashcardSurah, flashcardJuz);
        if (flashcardRandom) loaded = shuffle(loaded);
        loaded = loaded.slice(0, 8);
        const builtPool = loaded.length > 0 ? await buildPool(loaded) : [];
        if (!active) return;
        setCards(loaded);
        setPool(builtPool);
        setQuestions(buildQuestions('next', builtPool));
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load quiz cards.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashcardSection, flashcardSurah, flashcardJuz, flashcardRandom]);

  const question = questions[index] ?? null;

  const startSession = useCallback(
    (nextType: QuizType) => {
      setType(nextType);
      setQuestions(buildQuestions(nextType, pool));
      setIndex(0);
      setSelected(null);
      setAnswered(false);
      setCorrectCount(0);
      setErrors(0);
      setQuestionErrors(0);
      setOrderPicks([]);
      setOrderWrong([]);
      setFinished(false);
      setXpEarned(0);
      setNewBadges([]);
      setAnsweredByCard({});
      setError(null);
    },
    [pool]
  );

  const chooseOption = useCallback(
    (optionIndex: number) => {
      const current = questions[index];
      if (!current || current.kind === 'order' || answered || busy) return;
      setSelected(optionIndex);
      setAnswered(true);
      if (optionIndex === current.correctIndex) {
        setCorrectCount((count) => count + 1);
        bumpCardStat(current.cardKey, 0, 1);
      } else {
        setErrors((count) => count + 1);
        setQuestionErrors(1);
        bumpCardStat(current.cardKey, 1, 1);
      }
    },
    [answered, busy, bumpCardStat, index, questions]
  );

  const tapOrderOption = useCallback(
    (item: { ayah: number; text: string }) => {
      const current = questions[index];
      if (!current || current.kind !== 'order' || answered || busy) return;
      if (orderPicks.includes(item.ayah) || orderWrong.includes(item.ayah)) return;

      const expected = current.answer[orderPicks.length];
      if (expected === undefined) return;

      if (item.ayah === expected) {
        const nextPicks = [...orderPicks, item.ayah];
        setOrderPicks(nextPicks);
        if (nextPicks.length === current.answer.length) {
          setAnswered(true);
          bumpCardStat(current.cardKey, 0, 1);
        }
      } else {
        setQuestionErrors((count) => count + 1);
        setOrderWrong((previous) => [...previous, item.ayah]);
        bumpCardStat(current.cardKey, 1, 0);
        // Place the expected ayah automatically so the learner can continue.
        const nextPicks = [...orderPicks, expected];
        setOrderPicks(nextPicks);
        if (nextPicks.length === current.answer.length) {
          setAnswered(true);
          bumpCardStat(current.cardKey, 0, 1);
        }
      }
    },
    [answered, busy, bumpCardStat, index, orderPicks, orderWrong, questions]
  );

  const finishQuiz = useCallback(
    async (finalCorrect: number, finalErrors: number) => {
      setBusy(true);
      try {
        // Grade every card that had answered questions, each with its own
        // error rate — never one aggregate grade on an arbitrary card.
        let xp = 0;
        let gradedCount = 0;
        const byKey = new Map(cards.map((card) => [card.unitKey, card]));
        for (const [cardKey, stats] of Object.entries(answeredByCard)) {
          if (stats.answered <= 0) continue;
          const card = byKey.get(cardKey);
          if (!card) continue;
          const errorRate = Math.min(1, stats.errors / stats.answered);
          const result = await gradeCardReview({
            card,
            rating: gradeErrorMapping(errorRate),
            mode: 'quiz',
            errorCount: stats.errors,
          });
          xp += result.xp;
          gradedCount += 1;
          setCards((previous) =>
            previous.map((item) => (item.unitKey === result.card.unitKey ? result.card : item))
          );
        }
        if (gradedCount === 0) {
          // Nothing quizzed belongs to a card (e.g. distractor-only pool):
          // fall back to the old single-card path so XP still lands.
          const card = pickDueCard(cards);
          if (card) {
            const result = await gradeCardReview({
              card,
              rating: gradeErrorMapping(Math.min(1, finalErrors / Math.max(1, questions.length))),
              mode: 'quiz',
              errorCount: finalErrors,
            });
            xp = result.xp;
          }
        }

        setCorrectCount(finalCorrect);
        setErrors(finalErrors);
        setXpEarned(xp);
        setFinished(true);
        try {
          setNewBadges(await checkBadges(await getBadgeState()));
        } catch {
          setNewBadges([]);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save your quiz results.');
      } finally {
        setBusy(false);
      }
    },
    [answeredByCard, cards, questions.length]
  );

  const goNext = useCallback(() => {
    const current = questions[index];
    if (!current || !answered || busy) return;

    let finalErrors = errors;
    let finalCorrect = correctCount;
    if (current.kind === 'order') {
      finalErrors += questionErrors;
      if (questionErrors === 0) finalCorrect += 1;
      // Ordering mistakes are only known when the question ends, so fold them
      // into the running totals before advancing.
      setErrors(finalErrors);
      setCorrectCount(finalCorrect);
    }

    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setSelected(null);
      setAnswered(false);
      setQuestionErrors(0);
      setOrderPicks([]);
      setOrderWrong([]);
      return;
    }

    void finishQuiz(finalCorrect, finalErrors);
  }, [answered, busy, correctCount, errors, finishQuiz, index, questionErrors, questions]);

  // Listening questions play their ayah as soon as they appear.
  useEffect(() => {
    if (finished || !question || question.kind !== 'listen') return;
    playAyah(question.audio.surah, question.audio.ayah);
  }, [finished, playAyah, question]);

  const kindLabel = (kind: QuizType): string => {
    switch (kind) {
      case 'next':
        return 'NEXT AYAH';
      case 'blank':
        return 'FILL THE BLANK';
      case 'order':
        return 'PUT IN ORDER';
      case 'listen':
        return 'LISTENING';
    }
  };

  const optionQuestion = question && question.kind !== 'order' ? question : null;

  const optionStyle = (optionIndex: number) => {
    if (!optionQuestion) return { borderColor: theme.backgroundSelected, backgroundColor: theme.background };
    const chosen = selected === optionIndex;
    const correct = optionIndex === optionQuestion.correctIndex;
    if (answered && correct) {
      return {
        borderColor: Brand.emerald,
        backgroundColor: isDark ? '#10392C' : Brand.emeraldSoft,
      };
    }
    if (answered && chosen) {
      return {
        borderColor: isDark ? '#F28B82' : '#C0392B',
        backgroundColor: isDark ? '#3B1714' : '#FBE9E7',
      };
    }
    return { borderColor: theme.backgroundSelected, backgroundColor: theme.background };
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="quiz-back">
        <Ionicons name="arrow-back" size={22} color={theme.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>Quiz</ThemedText>
      <View style={[styles.progressPill, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.progressText}>
          {questions.length > 0
            ? `${Math.min(index + 1, questions.length)}/${questions.length}`
            : '0/0'}
        </ThemedText>
      </View>
    </View>
  );

  const typeTabs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.typeRow}>
      {QUIZ_TYPES.map((option, optionIndex) => {
        const active = option.key === type;
        return (
          <Pressable
            key={option.key}
            onPress={() => startSession(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Switch to ${option.label} quiz`}
            testID={`quiz-type-${optionIndex}`}
            style={[
              styles.typeChip,
              {
                borderColor: active ? Brand.emerald : theme.backgroundSelected,
                backgroundColor: active
                  ? isDark
                    ? Brand.emeraldDark
                    : Brand.emeraldSoft
                  : 'transparent',
              },
            ]}>
            <Ionicons
              name={option.icon}
              size={14}
              color={active ? (isDark ? '#fff' : Brand.emeraldDark) : theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.typeText,
                { color: active ? (isDark ? '#fff' : Brand.emeraldDark) : theme.text },
              ]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.center}>
          <ActivityIndicator size="large" color={Brand.emerald} />
          <ThemedText themeColor="textSecondary" style={styles.loadingText}>
            Preparing your quiz…
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
                name="help-circle-outline"
                size={30}
                color={isDark ? '#fff' : Brand.emeraldDark}
              />
            </View>
            <ThemedText style={styles.emptyTitle}>Nothing to quiz yet</ThemedText>
            <ThemedText style={styles.emptyBody} themeColor="textSecondary">
              Complete your first lesson — create a plan on the Today screen
            </ThemedText>
            <Pressable
              onPress={() => router.push('/')}
              style={[styles.primaryBtn, { backgroundColor: Brand.emerald }]}
              accessibilityRole="button"
              accessibilityLabel="Open the Today screen"
              testID="quiz-open-today">
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
            <ThemedText style={styles.summaryTitle}>Quiz complete</ThemedText>
            <ThemedText style={styles.scoreLine}>
              {correctCount} / {questions.length} correct
            </ThemedText>
            <ThemedText style={styles.xpLine} themeColor="textSecondary">
              +{xpEarned} XP · {errors} {errors === 1 ? 'error' : 'errors'}
            </ThemedText>
            {newBadges.length > 0 ? (
              <View style={[styles.badgeCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.badgeTitle}>New badge unlocked</ThemedText>
                <ThemedText style={styles.badgeLine}>{describeBadges(newBadges)}</ThemedText>
              </View>
            ) : null}
            <Pressable
              onPress={() => startSession(type)}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Brand.emerald, width: '100%' }]}
              accessibilityRole="button"
              accessibilityLabel="Play the quiz again"
              accessibilityState={{ disabled: busy }}
              testID="quiz-again">
              <Ionicons name="refresh" size={18} color="#fff" />
              <ThemedText style={styles.primaryBtnText}>Again</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={[styles.secondaryBtn, { borderColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Finish the quiz"
              testID="quiz-done">
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
          {typeTabs}

          <PracticeOptions />

          {error ? (
            <View style={[styles.errorCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.errorText} themeColor="textSecondary">
                {error}
              </ThemedText>
            </View>
          ) : null}

          {!question ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons
                name="bulb-outline"
                size={26}
                color={isDark ? Brand.gold : Brand.goldDark}
              />
              <ThemedText style={styles.emptyTitle}>Not enough ayahs for this quiz</ThemedText>
              <ThemedText style={styles.emptyBody} themeColor="textSecondary">
                Learn a few more ayahs, or try Flashcards and Scratch to build your first cards.
              </ThemedText>
              <Pressable
                onPress={() => router.replace('/practice/flashcards')}
                style={[styles.primaryBtn, { backgroundColor: Brand.emerald }]}
                accessibilityRole="button"
                accessibilityLabel="Open flashcards"
                testID="quiz-flashcards">
                <ThemedText style={styles.primaryBtnText}>Open Flashcards</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.questionCard, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.questionMetaRow}>
                <ThemedText style={styles.kindLabel} themeColor="textSecondary">
                  {kindLabel(question.kind)}
                </ThemedText>
                <ThemedText style={styles.sourceLabel} themeColor="textSecondary">
                  {question.kind === 'listen' ? 'Audio' : question.source}
                </ThemedText>
              </View>

              {question.kind === 'next' ? (
                <View style={styles.promptBlock}>
                  <ThemedText style={styles.promptHint} themeColor="textSecondary">
                    Which ayah comes next?
                  </ThemedText>
                  <ThemedText style={styles.arabicPrompt}>{question.prompt}</ThemedText>
                  <Pressable
                    onPress={() => playAyah(question.audio.surah, question.audio.ayah)}
                    style={[
                      styles.playBtn,
                      { backgroundColor: isDark ? Brand.emeraldDark : Brand.emeraldSoft },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Play the ayah"
                    accessibilityState={{ busy: playing }}
                    testID="quiz-play">
                    <Ionicons
                      name={playing ? 'volume-high' : 'play'}
                      size={16}
                      color={isDark ? '#fff' : Brand.emeraldDark}
                    />
                    <ThemedText
                      style={[
                        styles.playText,
                        { color: isDark ? '#fff' : Brand.emeraldDark },
                      ]}>
                      {playing ? 'Playing' : 'Listen'}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {question.kind === 'blank' ? (
                <View style={styles.promptBlock}>
                  <ThemedText style={styles.promptHint} themeColor="textSecondary">
                    Fill in the missing word
                  </ThemedText>
                  <ThemedText style={styles.arabicPrompt}>{question.masked}</ThemedText>
                </View>
              ) : null}

              {question.kind === 'listen' ? (
                <View style={styles.promptBlock}>
                  <ThemedText style={styles.promptHint} themeColor="textSecondary">
                    Listen, then pick the ayah that follows
                  </ThemedText>
                  <Pressable
                    onPress={() => playAyah(question.audio.surah, question.audio.ayah)}
                    style={[
                      styles.listenBtn,
                      { backgroundColor: isDark ? Brand.emeraldDark : Brand.emerald },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Play the ayah audio"
                    accessibilityState={{ busy: playing }}
                    testID="quiz-play">
                    <Ionicons name="volume-high" size={30} color="#fff" />
                    <ThemedText style={styles.listenText}>
                      {playing ? 'Playing…' : 'Replay ayah'}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {question.kind === 'order' ? (
                <View style={styles.orderSection}>
                  <ThemedText style={styles.promptHint} themeColor="textSecondary">
                    Tap the ayahs in the correct order
                  </ThemedText>
                  <View style={styles.orderList}>
                    {question.items.map((item, itemIndex) => {
                      const pickIndex = orderPicks.indexOf(item.ayah);
                      const placed = pickIndex >= 0;
                      const wrong = orderWrong.includes(item.ayah);
                      return (
                        <Pressable
                          key={item.ayah}
                          onPress={() => tapOrderOption(item)}
                          disabled={answered || placed || wrong}
                          accessibilityRole="button"
                          accessibilityLabel={`Ayah option ${itemIndex + 1}`}
                          accessibilityState={{ disabled: answered || placed || wrong }}
                          testID={`quiz-option-${itemIndex}`}
                          style={[
                            styles.orderItem,
                            {
                              borderColor: wrong
                                ? isDark
                                  ? '#F28B82'
                                  : '#C0392B'
                                : placed
                                  ? Brand.emerald
                                  : theme.backgroundSelected,
                              backgroundColor: theme.background,
                              opacity: answered && !placed ? 0.55 : 1,
                            },
                          ]}>
                          <View
                            style={[
                              styles.orderBadge,
                              {
                                backgroundColor: wrong
                                  ? isDark
                                    ? '#B03A2E'
                                    : '#C0392B'
                                  : placed
                                    ? Brand.emerald
                                    : theme.backgroundSelected,
                              },
                            ]}>
                            <ThemedText
                              style={[
                                styles.orderBadgeText,
                                { color: placed || wrong ? '#fff' : theme.textSecondary },
                              ]}>
                              {wrong ? '×' : placed ? String(pickIndex + 1) : '•'}
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.orderText}>{item.text}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {optionQuestion ? (
                <View style={styles.options}>
                  {optionQuestion.options.map((option, optionIndex) => (
                    <Pressable
                      key={`${optionIndex}-${option.slice(0, 12)}`}
                      onPress={() => chooseOption(optionIndex)}
                      disabled={answered || busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Option ${optionIndex + 1}`}
                      accessibilityState={{
                        disabled: answered || busy,
                        selected: selected === optionIndex,
                      }}
                      testID={`quiz-option-${optionIndex}`}
                      style={[
                        styles.option,
                        optionStyle(optionIndex),
                        {
                          borderWidth:
                            answered && optionIndex === optionQuestion.correctIndex ? 2 : 1,
                        },
                      ]}>
                      <ThemedText style={styles.optionText}>{option}</ThemedText>
                      {answered && optionIndex === optionQuestion.correctIndex ? (
                        <Ionicons name="checkmark-circle" size={18} color={Brand.emerald} />
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {answered ? (
                <View style={styles.feedbackRow}>
                  {question.kind === 'order' ? (
                    <ThemedText style={styles.feedbackText} themeColor="textSecondary">
                      {questionErrors === 0
                        ? 'Perfect order!'
                        : `Order complete with ${questionErrors} ${
                            questionErrors === 1 ? 'mistake' : 'mistakes'
                          }.`}
                    </ThemedText>
                  ) : selected === question.correctIndex ? (
                    <ThemedText style={[styles.feedbackText, { color: Brand.emerald }]}>
                      Correct!
                    </ThemedText>
                  ) : (
                    <ThemedText style={[styles.feedbackText, { color: isDark ? '#F28B82' : '#C0392B' }]}>
                      Not quite — the correct ayah is highlighted.
                    </ThemedText>
                  )}
                </View>
              ) : (
                <ThemedText style={styles.tapHint} themeColor="textSecondary">
                  {question.kind === 'order'
                    ? 'Tap each ayah once, in order.'
                    : 'Tap one answer.'}
                </ThemedText>
              )}

              {answered && question.kind === 'blank' ? (
                <View style={styles.fullAyahBlock}>
                  <ThemedText style={styles.fullAyahLabel} themeColor="textSecondary">
                    Full ayah
                  </ThemedText>
                  <ThemedText style={styles.fullAyah}>{question.fullText}</ThemedText>
                </View>
              ) : null}

              {answered ? (
                <Pressable
                  onPress={goNext}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: Brand.emerald },
                    (pressed || busy) && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    index + 1 >= questions.length ? 'See quiz results' : 'Next question'
                  }
                  accessibilityState={{ disabled: busy }}
                  testID="quiz-next">
                  <ThemedText style={styles.primaryBtnText}>
                    {index + 1 >= questions.length ? 'See results' : 'Next'}
                  </ThemedText>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </Pressable>
              ) : null}
            </View>
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
  typeRow: { gap: Spacing.one, paddingVertical: Spacing.one, paddingRight: Spacing.three },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  typeText: { fontSize: 12, fontWeight: 700 },
  errorCard: { borderRadius: 12, padding: Spacing.three },
  errorText: { fontSize: 12 },
  questionCard: { borderRadius: 22, padding: Spacing.four, gap: Spacing.three, marginTop: Spacing.one },
  questionMetaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  kindLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 1.2 },
  sourceLabel: { fontSize: 10, fontWeight: 600 },
  promptBlock: { gap: Spacing.two },
  promptHint: { fontSize: 12, fontWeight: 600 },
  arabicPrompt: {
    fontFamily: 'Amiri',
    fontSize: 24,
    lineHeight: 42,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  playText: { fontSize: 12, fontWeight: 700 },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 16,
    paddingVertical: Spacing.four,
    marginTop: Spacing.one,
  },
  listenText: { color: '#fff', fontSize: 16, fontWeight: 700 },
  options: { gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  optionText: {
    flex: 1,
    fontFamily: 'Amiri',
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  orderSection: { gap: Spacing.two },
  orderList: { gap: Spacing.two },
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: { fontSize: 13, fontWeight: 700 },
  orderText: {
    flex: 1,
    fontFamily: 'Amiri',
    fontSize: 17,
    lineHeight: 30,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  feedbackRow: { flexDirection: 'row', alignItems: 'center' },
  feedbackText: { fontSize: 13, fontWeight: 700 },
  tapHint: { fontSize: 12, textAlign: 'center' },
  fullAyahBlock: { gap: Spacing.one },
  fullAyahLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 0.8 },
  fullAyah: {
    fontFamily: 'Amiri',
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  loadingText: { fontSize: 13 },
  emptyCard: {
    borderRadius: 20,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
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
  scoreLine: { fontSize: 20, fontWeight: 700 },
  xpLine: { fontSize: 14, textAlign: 'center' },
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
