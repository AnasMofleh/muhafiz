import { Ionicons } from '@expo/vector-icons';
import type { SkPath } from '@shopify/react-native-skia';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
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

// ---------------------------------------------------------------------------
// Skia is loaded lazily and only on native. The web build (and any device
// where the CanvasKit runtime fails) uses the press-and-hold fallback below.
// ---------------------------------------------------------------------------

type SkiaLib = typeof import('@shopify/react-native-skia');

function loadSkia(): SkiaLib | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@shopify/react-native-skia') as SkiaLib;
  } catch (error) {
    console.warn('Muhafiz: Skia unavailable, using hold-to-reveal', error);
    return null;
  }
}

const SKIA: SkiaLib | null = loadSkia();

interface Point {
  x: number;
  y: number;
}

const GRID_COLS = 12;
const GRID_ROWS = 8;
const SCRATCH_RADIUS = 26;
const REVEAL_THRESHOLD = 0.6;

/** Rough coverage: how many coarse grid cells the scratched path has hit. */
function computeCoverage(points: Point[], width: number, height: number): number {
  if (points.length === 0 || width <= 0 || height <= 0) return 0;

  const cellW = width / GRID_COLS;
  const cellH = height / GRID_ROWS;
  const hits = new Set<number>();

  const mark = (x: number, y: number) => {
    const c0 = Math.max(0, Math.floor((x - SCRATCH_RADIUS) / cellW));
    const c1 = Math.min(GRID_COLS - 1, Math.floor((x + SCRATCH_RADIUS) / cellW));
    const r0 = Math.max(0, Math.floor((y - SCRATCH_RADIUS) / cellH));
    const r1 = Math.min(GRID_ROWS - 1, Math.floor((y + SCRATCH_RADIUS) / cellH));
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const cx = (col + 0.5) * cellW;
        const cy = (row + 0.5) * cellH;
        const dx = cx - x;
        const dy = cy - y;
        if (dx * dx + dy * dy <= SCRATCH_RADIUS * SCRATCH_RADIUS) {
          hits.add(row * GRID_COLS + col);
        }
      }
    }
  };

  mark(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(distance / (SCRATCH_RADIUS / 2)));
    for (let step = 1; step <= steps; step += 1) {
      mark(a.x + (dx * step) / steps, a.y + (dy * step) / steps);
    }
  }

  return hits.size / (GRID_COLS * GRID_ROWS);
}

interface ScratchSurfaceProps {
  width: number;
  height: number;
  coverColor: string;
  patternColor: string;
  onReveal: () => void;
}

function ScratchSurface({ width, height, coverColor, patternColor, onReveal }: ScratchSurfaceProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const pointsRef = useRef<Point[]>([]);
  const revealedRef = useRef(false);

  const appendPoint = useCallback(
    (x: number, y: number) => {
      if (revealedRef.current) return;
      const next = [...pointsRef.current, { x, y }];
      pointsRef.current = next.length > 900 ? next.slice(next.length - 900) : next;
      setPoints(pointsRef.current.slice());
      if (computeCoverage(pointsRef.current, width, height) >= REVEAL_THRESHOLD) {
        revealedRef.current = true;
        onReveal();
      }
    },
    [height, onReveal, width]
  );

  const responder = useMemo(
    () => ({
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderGrant: (event: GestureResponderEvent) =>
        appendPoint(event.nativeEvent.locationX, event.nativeEvent.locationY),
      onResponderMove: (event: GestureResponderEvent) =>
        appendPoint(event.nativeEvent.locationX, event.nativeEvent.locationY),
    }),
    [appendPoint]
  );

  const path = useMemo<SkPath | null>(() => {
    if (!SKIA) return null;
    const builder = SKIA.Skia.PathBuilder.Make();
    if (points.length === 0) return builder.detach();

    builder.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      // A dot still needs a tiny segment so the stroke paints something.
      builder.lineTo(points[0].x + 0.1, points[0].y + 0.1);
      return builder.detach();
    }

    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      builder.quadTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    builder.lineTo(last.x, last.y);
    return builder.detach();
  }, [points]);

  if (!SKIA) return null;

  const { Canvas, Rect, Path, BlurMask } = SKIA;

  return (
    <View style={StyleSheet.absoluteFill} testID="scratch-canvas" {...responder}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height} color={coverColor} />
        <Rect x={0} y={0} width={width} height={height} color={patternColor} opacity={0.26} />
        {path ? (
          <Path
            path={path}
            style="stroke"
            strokeWidth={40}
            strokeCap="round"
            strokeJoin="round"
            color="#000000"
            blendMode="clear">
            <BlurMask blur={2} style="normal" />
          </Path>
        ) : null}
      </Canvas>
    </View>
  );
}

interface HoldToRevealProps {
  coverColor: string;
  isDark: boolean;
  onReveal: () => void;
}

function HoldToReveal({ coverColor, isDark, onReveal }: HoldToRevealProps) {
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setProgress(0);
  }, []);

  const begin = useCallback(() => {
    if (timerRef.current) return;
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const next = Math.min(1, (Date.now() - startRef.current) / 1500);
      setProgress(next);
      if (next >= 1) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        onReveal();
      }
    }, 40);
  }, [onReveal]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  return (
    <Pressable
      onPressIn={begin}
      onPressOut={stop}
      style={[styles.holdSurface, { backgroundColor: coverColor }]}
      accessibilityRole="button"
      accessibilityLabel="Hold to reveal the ayah"
      accessibilityHint="Press and hold for 1.5 seconds to uncover the text"
      testID="scratch-canvas">
      <Ionicons
        name="hand-left-outline"
        size={28}
        color={isDark ? '#F7EFD8' : Brand.goldDark}
      />
      <ThemedText
        style={[styles.holdTitle, { color: isDark ? '#F7EFD8' : Brand.goldDark }]}>
        Hold to reveal
      </ThemedText>
      <ThemedText
        style={[styles.holdSub, { color: isDark ? '#F7EFD8' : Brand.goldDark }]}>
        Keep your finger down for 1.5 seconds
      </ThemedText>
      <View style={[styles.holdTrack, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
        <View
          style={[
            styles.holdFill,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: Brand.emerald },
          ]}
        />
      </View>
    </Pressable>
  );
}

interface ScratchBoundaryProps {
  fallback: ReactNode;
  onError: () => void;
  children: ReactNode;
}

class ScratchBoundary extends Component<ScratchBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('Muhafiz: scratch canvas failed, using hold-to-reveal', error);
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const GRADE_BUTTONS: { rating: Rating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export default function ScratchScreen() {
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
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [skiaFailed, setSkiaFailed] = useState(false);

  useEffect(() => {
    if (!SKIA) {
      setSkiaFailed(true);
      return;
    }
    try {
      const probe = SKIA.Skia.Path.Make();
      probe.dispose();
    } catch {
      setSkiaFailed(true);
    }
  }, []);

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

  useEffect(() => {
    setRevealed(false);
    setArea({ width: 0, height: 0 });
  }, [cardKey]);

  const ayahText =
    card && surah ? surah.ayahs[card.startAyah - 1]?.text_uthmani ?? '' : '';

  const handleReveal = useCallback(() => setRevealed(true), []);

  const handleGrade = useCallback(
    async (rating: Rating) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const result = await gradeCardReview({ card, rating, mode: 'scratch' });
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

  const handleArea = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea({ width, height });
  }, []);

  const gradeColor = (rating: Rating): string => {
    if (rating === 1) return isDark ? '#B03A2E' : '#C0392B';
    if (rating === 2) return isDark ? '#C98A1B' : '#B7791F';
    if (rating === 3) return Brand.emerald;
    return isDark ? '#0F6B54' : Brand.emeraldDark;
  };

  const coverColor = isDark ? '#6E5A1A' : Brand.goldSoft;
  const usingFallback = skiaFailed || !SKIA;

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="scratch-back">
        <Ionicons name="arrow-back" size={22} color={theme.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>Scratch &amp; Reveal</ThemedText>
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
                name="brush-outline"
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
              testID="scratch-open-today">
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
              testID="scratch-again">
              <Ionicons name="refresh" size={18} color="#fff" />
              <ThemedText style={styles.primaryBtnText}>Another round</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={[styles.secondaryBtn, { borderColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Done practicing"
              testID="scratch-done">
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
                testID="scratch-play">
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

            <View style={styles.scratchArea} onLayout={handleArea}>
              <ThemedText
                style={[
                  styles.arabic,
                  { fontSize: 24 * fontScale, lineHeight: 42 * fontScale },
                ]}>
                {ayahText}
              </ThemedText>

              {!revealed && area.width > 0 && area.height > 0 ? (
                usingFallback ? (
                  <HoldToReveal
                    key={cardKey}
                    coverColor={coverColor}
                    isDark={isDark}
                    onReveal={handleReveal}
                  />
                ) : (
                  <ScratchBoundary
                    fallback={
                      <HoldToReveal
                        key={`fallback-${cardKey}`}
                        coverColor={coverColor}
                        isDark={isDark}
                        onReveal={handleReveal}
                      />
                    }
                    onError={() => setSkiaFailed(true)}>
                    <ScratchSurface
                      key={cardKey}
                      width={area.width}
                      height={area.height}
                      coverColor={coverColor}
                      patternColor={Brand.gold}
                      onReveal={handleReveal}
                    />
                  </ScratchBoundary>
                )
              ) : null}

              {!revealed && !usingFallback ? (
                <View pointerEvents="none" style={styles.scratchHintWrap}>
                  <View style={styles.scratchHint}>
                    <Ionicons name="brush-outline" size={14} color={Brand.goldDark} />
                    <ThemedText style={styles.scratchHintText}>Scratch to reveal</ThemedText>
                  </View>
                </View>
              ) : null}
            </View>

            {revealed ? (
              <View style={styles.revealedRow}>
                <Ionicons name="checkmark-circle" size={16} color={Brand.emerald} />
                <ThemedText style={styles.revealedText} themeColor="textSecondary">
                  Revealed — how did you do?
                </ThemedText>
              </View>
            ) : null}
          </View>

          {!revealed ? (
            <Pressable
              onPress={handleReveal}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: Brand.emerald },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Recited it, reveal the ayah"
              testID="scratch-recited">
              <Ionicons name="eye-outline" size={18} color="#fff" />
              <ThemedText style={styles.primaryBtnText}>Recited it</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.gradeSection}>
              <ThemedText style={styles.gradePrompt} themeColor="textSecondary">
                How well did you recall it?
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
                    testID={`scratch-grade-${rating}`}>
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
  scratchArea: {
    minHeight: 220,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  arabic: { fontFamily: 'Amiri', textAlign: 'right', writingDirection: 'rtl' },
  scratchHintWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: Spacing.two,
  },
  scratchHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  scratchHintText: { color: '#F7EFD8', fontSize: 11, fontWeight: 700 },
  holdSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  holdTitle: { fontSize: 17, fontWeight: 700 },
  holdSub: { fontSize: 12, opacity: 0.8 },
  holdTrack: {
    width: '70%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  holdFill: { height: 6, borderRadius: 3 },
  revealedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  revealedText: { fontSize: 12, fontWeight: 600 },
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
