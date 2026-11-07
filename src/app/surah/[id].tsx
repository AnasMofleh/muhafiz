import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MushafText } from '@/components/mushaf-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { AyahRef, SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { ayahAudioUrl, getReciter, PLAYBACK_RATES, RECITERS, REPEAT_OPTIONS } from '@/lib/reciters';
import { useSettings, type MushafTextColor } from '@/store/settings';

const COLOR_OPTIONS: { id: MushafTextColor; icon: 'text-outline' | 'leaf-outline' | 'star-outline' | 'water-outline' }[] = [
  { id: 'classic', icon: 'text-outline' },
  { id: 'green', icon: 'leaf-outline' },
  { id: 'gold', icon: 'star-outline' },
  { id: 'teal', icon: 'water-outline' },
];

export default function SurahScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const surahNumber = Number(id);
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const t = useT();

  const {
    reciterId,
    playbackRate,
    repeatAyah,
    autoAdvance,
    fontScale,
    mushafLayout,
    mushafTextColor,
    mushafParchment,
    setMushafLayout,
    setMushafTextColor,
    setMushafParchment,
  } = useSettings();
  const reciter = getReciter(reciterId);

  // Surah data loads on demand (per-surah code splitting).
  const [surah, setSurah] = useState<SurahData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSurah(null);
    setInvalid(false);
    getSurah(surahNumber).then((s) => {
      if (cancelled) return;
      if (s) setSurah(s);
      else setInvalid(true);
    });
    return () => {
      cancelled = true;
    };
  }, [surahNumber]);

  // One stable player for the whole screen — never recreate it (useAudioPlayer
  // releases and rebuilds its player whenever the source changes, which would
  // orphan every play() call). Switch sources with player.replace() instead.
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const [current, setCurrent] = useState<AyahRef | null>(null);
  const [reciterOpen, setReciterOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const playsDoneRef = useRef(0); // plays started for the current ayah (incl. first)
  const currentRef = useRef<AyahRef | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // Keep the playback rate in sync with the setting. 'high' quality also
  // enables pitch preservation on web.
  useEffect(() => {
    player.setPlaybackRate(playbackRate, 'high');
  }, [playbackRate, player]);

  const hasEnded = () =>
    status.didJustFinish ||
    (status.duration > 0 && status.currentTime >= status.duration - 0.1);

  const playAyah = (ref: AyahRef) => {
    const cur = currentRef.current;
    const same = cur !== null && cur.surah === ref.surah && cur.ayah === ref.ayah;
    if (!same) {
      player.replace(ayahAudioUrl(reciter, ref.surah, ref.ayah));
      player.setPlaybackRate(playbackRate, 'high'); // replace resets rate
      playsDoneRef.current = 0;
    } else if (hasEnded()) {
      // Restart a finished ayah from the beginning.
      player.seekTo(0);
      playsDoneRef.current = 0;
    }
    currentRef.current = ref;
    setCurrent(ref);
    playsDoneRef.current += 1;
    player.play();
  };

  const togglePlay = () => {
    if (!current) return;
    if (player.playing) {
      player.pause();
      return;
    }
    if (hasEnded()) {
      player.seekTo(0);
      playsDoneRef.current = 0;
      playsDoneRef.current += 1;
    }
    player.play();
  };

  const replay = () => {
    if (!current) return;
    player.seekTo(0);
    playsDoneRef.current = 1;
    player.play();
  };

  // Switching reciter mid-play keeps the current ayah and playback intent.
  useEffect(() => {
    const cur = currentRef.current;
    if (!cur) return;
    const wasPlaying = player.playing;
    player.replace(ayahAudioUrl(getReciter(reciterId), cur.surah, cur.ayah));
    player.setPlaybackRate(playbackRate, 'high');
    if (wasPlaying) player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reciterId]);

  // Ayah finished: repeat it, or auto-advance to the next one.
  useEffect(() => {
    if (!status.didJustFinish) return;
    if (playsDoneRef.current < repeatAyah) {
      playsDoneRef.current += 1;
      player.seekTo(0);
      player.play();
      return;
    }
    const cur = currentRef.current;
    if (autoAdvance && cur && surah) {
      const next: AyahRef | null =
        cur.ayah < surah.ayahCount ? { surah: cur.surah, ayah: cur.ayah + 1 } : null;
      if (next) {
        playAyah(next);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish, repeatAyah, autoAdvance, surah]);

  // Keep a ref to the latest togglePlay so the once-registered keyboard
  // listener never closes over a stale handler.
  const togglePlayRef = useRef(togglePlay);
  useEffect(() => {
    togglePlayRef.current = togglePlay;
  }, [togglePlay]);

  // Web keyboard shortcut: space toggles playback.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (invalid) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.centerWrap}>
          <ThemedText style={styles.notFoundTitle}>{t('mushaf.surahNotFound')}</ThemedText>
          <ThemedText style={styles.notFoundSub} themeColor="textSecondary">
            {t('mushaf.surahNotFoundBody')}
          </ThemedText>
          <Pressable
            onPress={() => router.replace('/')}
            style={[styles.backHomeBtn, { backgroundColor: Brand.emerald }]}
            accessibilityRole="button"
            accessibilityLabel={t('mushaf.backToList')}>
            <ThemedText style={styles.backHomeText}>{t('mushaf.backToList')}</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!surah) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.centerWrap}>
          <ThemedText themeColor="textSecondary">{t('common.loading')}</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const onAyahTap = (ayahNumber: number) => {
    const ref = { surah: surahNumber, ayah: ayahNumber };
    if (current?.surah === surahNumber && current?.ayah === ayahNumber && player.playing) {
      togglePlay();
    } else {
      playAyah(ref);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText style={styles.surahName}>{surah.name}</ThemedText>
            <ThemedText style={styles.surahSub} themeColor="textSecondary">
              {surah.englishName} · {surah.ayahCount} {t('common.ayahs')} ·{' '}
              {surah.revelationType === 'Meccan' ? t('mushaf.meccan') : t('mushaf.medinan')}
            </ThemedText>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Layout / palette toolbar */}
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => {
              const next =
                mushafLayout === 'lines' ? 'flow' : mushafLayout === 'flow' ? 'pages' : 'lines';
              setMushafLayout(next);
            }}
            style={[styles.toolBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={t('settings.layout')}
            testID="mushaf-layout-toggle">
            <Ionicons
              name={mushafLayout === 'lines' ? 'reader-outline' : mushafLayout === 'flow' ? 'copy-outline' : 'list-outline'}
              size={18}
              color={Brand.teal}
            />
            <ThemedText type="smallBold" style={{ color: Brand.teal }}>
              {mushafLayout === 'lines'
                ? t('mushaf.layoutFlow')
                : mushafLayout === 'flow'
                  ? t('mushaf.layoutPages')
                  : t('mushaf.layoutLines')}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setPaletteOpen(true)}
            style={[styles.toolBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={t('mushaf.textColor')}
            testID="mushaf-palette">
            <Ionicons name="color-palette-outline" size={18} color={Brand.gold} />
            <ThemedText type="smallBold" style={{ color: Brand.gold }}>
              {t('mushaf.textColor')}
            </ThemedText>
          </Pressable>
          <View style={styles.toolbarSpacer} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.toolbarHint}>
            {t('common.surah')} {surahNumber}
          </ThemedText>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          <MushafText
            surah={surah}
            layout={mushafLayout}
            textColor={mushafTextColor}
            parchment={mushafParchment}
            fontScale={fontScale}
            currentAyah={current?.surah === surahNumber ? current.ayah : undefined}
            onAyahTap={onAyahTap}
          />
        </ScrollView>

        {/* Player bar */}
        {current && (
          <View style={[styles.playerBar, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.playerInfo}>
              <ThemedText style={styles.playerRef}>
                {surahNumber}:{current.ayah}
              </ThemedText>
              <ThemedText style={styles.playerReciter} themeColor="textSecondary" numberOfLines={1}>
                {reciter.name}
              </ThemedText>
            </View>
            <View style={styles.playerControls}>
              <Pressable
                onPress={replay}
                style={styles.playerBtn}
                accessibilityRole="button"
                accessibilityLabel={t('mushaf.replay')}>
                <Ionicons name="refresh" size={20} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={togglePlay}
                style={[styles.playerBtn, styles.playBtn]}
                accessibilityRole="button"
                accessibilityLabel={player.playing ? t('mushaf.pause') : t('mushaf.play')}
                accessibilityState={{ selected: player.playing }}>
                <Ionicons name={player.playing ? 'pause' : 'play'} size={26} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => setReciterOpen(true)}
                style={styles.playerBtn}
                accessibilityRole="button"
                accessibilityLabel={t('mushaf.reciter')}>
                <Ionicons name="person-circle-outline" size={22} color={theme.text} />
              </Pressable>
            </View>
            <View style={styles.playerMeta}>
              <Pressable
                onPress={() => {
                  const i = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
                  const next = PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
                  useSettings.getState().setPlaybackRate(next);
                }}
                style={[styles.chip, { borderColor: theme.backgroundSelected }]}
                accessibilityRole="button"
                accessibilityLabel={`${t('mushaf.speed')} ${playbackRate}×`}>
                <ThemedText style={styles.chipText}>{playbackRate}×</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const i = REPEAT_OPTIONS.indexOf(repeatAyah as (typeof REPEAT_OPTIONS)[number]);
                  const next = REPEAT_OPTIONS[(i + 1) % REPEAT_OPTIONS.length];
                  useSettings.getState().setRepeatAyah(next);
                }}
                style={[styles.chip, { borderColor: theme.backgroundSelected }]}
                accessibilityRole="button"
                accessibilityLabel={`${t('mushaf.repeat')} ×${repeatAyah}`}>
                <ThemedText style={styles.chipText}>×{repeatAyah}</ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        {/* Palette modal */}
        <Modal
          visible={paletteOpen}
          transparent
          animationType={reduceMotion ? 'none' : 'slide'}
          onRequestClose={() => setPaletteOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setPaletteOpen(false)}
            testID="mushaf-palette-backdrop">
            <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
              <Pressable onPress={() => {}} style={styles.sheetInner}>
                <ThemedText style={styles.sheetTitle}>{t('mushaf.textColor')}</ThemedText>
                <View style={styles.colorRow}>
                  {COLOR_OPTIONS.map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={() => setMushafTextColor(option.id)}
                      style={[
                        styles.colorOption,
                        {
                          borderColor:
                            mushafTextColor === option.id ? Brand.gold : theme.backgroundSelected,
                          backgroundColor:
                            mushafTextColor === option.id ? Brand.goldSoft : 'transparent',
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={t(`mushaf.color${option.id[0].toUpperCase()}${option.id.slice(1)}`)}>
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={
                          option.id === 'classic'
                            ? theme.text
                            : option.id === 'green'
                              ? Brand.emerald
                              : option.id === 'gold'
                                ? Brand.gold
                                : Brand.teal
                        }
                      />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.parchmentRow}>
                  <ThemedText style={styles.parchmentLabel}>{t('mushaf.parchment')}</ThemedText>
                  <Switch
                    value={mushafParchment}
                    onValueChange={setMushafParchment}
                    trackColor={{ true: Brand.emerald }}
                  />
                </View>
              </Pressable>
            </SafeAreaView>
          </Pressable>
        </Modal>

        {/* Reciter picker */}
        <Modal
          visible={reciterOpen}
          transparent
          animationType={reduceMotion ? 'none' : 'slide'}
          onRequestClose={() => setReciterOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setReciterOpen(false)}>
            <SafeAreaView
              edges={['bottom']}
              style={[styles.sheet, { backgroundColor: theme.background }]}>
              <Pressable onPress={() => {}} style={styles.sheetInner}>
                <ThemedText style={styles.sheetTitle}>{t('mushaf.reciter')}</ThemedText>
                <FlatList
                  data={RECITERS}
                  keyExtractor={(r) => r.id}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => {
                        useSettings.getState().setReciter(item.id);
                        setReciterOpen(false);
                      }}
                      style={styles.reciterRow}
                      accessibilityRole="button"
                      accessibilityState={{ selected: item.id === reciterId }}>
                      <View style={styles.reciterText}>
                        <ThemedText style={styles.reciterName}>{item.name}</ThemedText>
                        {item.note ? (
                          <ThemedText style={styles.reciterNote} themeColor="textSecondary">
                            {item.note}
                          </ThemedText>
                        ) : null}
                      </View>
                      {item.id === reciterId && <Ionicons name="checkmark-circle" size={22} color={Brand.emerald} />}
                    </Pressable>
                  )}
                />
              </Pressable>
            </SafeAreaView>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  notFoundTitle: { fontSize: 24, fontWeight: 700 },
  notFoundSub: { fontSize: 15, textAlign: 'center' },
  backHomeBtn: { marginTop: Spacing.three, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  backHomeText: { color: '#fff', fontSize: 15, fontWeight: 600 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  headerText: { flex: 1, alignItems: 'center' },
  headerRight: { width: 38 },
  surahName: { fontSize: 20, fontFamily: 'Amiri-Bold', lineHeight: 30 },
  surahSub: { fontSize: 12 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  toolbarSpacer: { flex: 1 },
  toolbarHint: { fontSize: 11 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  nowPlaying: { fontSize: 12, marginTop: 2, textAlign: 'left' },
  playerBar: {
    borderRadius: 16,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  playerInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  playerRef: { fontSize: 15, fontWeight: 700 },
  playerReciter: { fontSize: 12, flex: 1 },
  playerControls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.four },
  playerBtn: { padding: Spacing.two },
  playBtn: {
    backgroundColor: Brand.emerald,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerMeta: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: 600 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' },
  sheetInner: { padding: Spacing.four },
  sheetTitle: { fontSize: 20, fontWeight: 700, marginBottom: Spacing.two },
  colorRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  colorOption: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  parchmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
  },
  parchmentLabel: { fontSize: 15, fontWeight: 600 },
  reciterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.three, gap: Spacing.two },
  reciterText: { flex: 1 },
  reciterName: { fontSize: 16, fontWeight: 600 },
  reciterNote: { fontSize: 12 },
});
