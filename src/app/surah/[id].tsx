import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { getSurah } from '@/data/quran';
import type { AyahRef } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { ayahAudioUrl, getReciter, PLAYBACK_RATES, RECITERS, REPEAT_OPTIONS } from '@/lib/reciters';
import { useSettings } from '@/store/settings';

const BASMALA_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

export default function SurahScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const surahNumber = Number(id);
  const surah = useMemo(() => getSurah(surahNumber), [surahNumber]);
  const theme = useTheme();
  const router = useRouter();

  const { reciterId, playbackRate, repeatAyah, autoAdvance, fontScale } = useSettings();
  const reciter = getReciter(reciterId);

  const [current, setCurrent] = useState<AyahRef | null>(null);
  const [reciterOpen, setReciterOpen] = useState(false);
  const repeatLeftRef = useRef(0);
  const currentRef = useRef<AyahRef | null>(null);

  const player = useAudioPlayer(current ? ayahAudioUrl(reciter, current.surah, current.ayah) : null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      player.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the playback rate in sync with the setting.
  useEffect(() => {
    player.setPlaybackRate(playbackRate, 'medium');
  }, [playbackRate, player]);

  const playAyah = (ref: AyahRef) => {
    repeatLeftRef.current = repeatAyah - 1;
    currentRef.current = ref;
    setCurrent(ref);
    player.play();
  };

  const togglePlay = () => {
    if (!current) return;
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const replay = () => {
    if (!current) return;
    repeatLeftRef.current = repeatAyah - 1;
    player.seekTo(0);
    player.play();
  };

  // Ayah finished: repeat it, or auto-advance to the next one.
  useEffect(() => {
    if (!status.didJustFinish) return;
    if (repeatLeftRef.current > 0) {
      repeatLeftRef.current -= 1;
      player.seekTo(0);
      player.play();
      return;
    }
    const cur = currentRef.current;
    if (autoAdvance && cur) {
      const next: AyahRef | null =
        cur.ayah < surah.ayahCount ? { surah: cur.surah, ayah: cur.ayah + 1 } : null;
      if (next) {
        playAyah(next);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  // Web keyboard shortcut: space toggles playback.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showBasmala = surah.ayahs[0]?.basmalaStripped === true;
  const highlight = theme.text === '#ffffff' ? '#243129' : Brand.ayahHighlight;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText style={styles.surahName}>{surah.name}</ThemedText>
            <ThemedText style={styles.surahSub} themeColor="textSecondary">
              {surah.englishName} · {surah.ayahCount} ayahs · {surah.revelationType}
            </ThemedText>
          </View>
          <View style={styles.headerRight} />
        </View>

        <FlatList
          data={surah.ayahs}
          keyExtractor={(a) => String(a.number)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            showBasmala ? (
              <ThemedText style={[styles.basmala, { fontSize: 24 * fontScale }]}>
                {BASMALA_TEXT}
              </ThemedText>
            ) : undefined
          }
          renderItem={({ item }) => {
            const isCurrent = current?.surah === surahNumber && current?.ayah === item.number;
            return (
              <Pressable
                onPress={() => (isCurrent && player.playing ? togglePlay() : playAyah({ surah: surahNumber, ayah: item.number }))}
                style={[styles.ayah, isCurrent && { backgroundColor: highlight }]}>
                <ThemedText
                  style={[styles.ayahText, { fontSize: 26 * fontScale }]}
                  selectable>
                  {item.text_uthmani}
                  {item.sajda ? (
                    <ThemedText style={styles.sajda} themeColor="textSecondary">
                      {' ۩'}
                    </ThemedText>
                  ) : null}
                  <View style={styles.ayahEnd}>
                    <ThemedText style={styles.ayahEndNumber}>{item.number}</ThemedText>
                  </View>
                </ThemedText>
                {isCurrent && (
                  <ThemedText style={styles.nowPlaying} themeColor="textSecondary">
                    {player.playing ? '▶' : '⏸'} {reciter.name}
                  </ThemedText>
                )}
              </Pressable>
            );
          }}
        />

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
              <Pressable onPress={replay} style={styles.playerBtn} accessibilityLabel="Replay ayah">
                <Ionicons name="refresh" size={20} color={theme.text} />
              </Pressable>
              <Pressable onPress={togglePlay} style={[styles.playerBtn, styles.playBtn]} accessibilityLabel="Play or pause">
                <Ionicons name={player.playing ? 'pause' : 'play'} size={26} color="#fff" />
              </Pressable>
              <Pressable onPress={() => setReciterOpen(true)} style={styles.playerBtn} accessibilityLabel="Choose reciter">
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
                accessibilityLabel="Playback speed">
                <ThemedText style={styles.chipText}>{playbackRate}×</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const i = REPEAT_OPTIONS.indexOf(repeatAyah as (typeof REPEAT_OPTIONS)[number]);
                  const next = REPEAT_OPTIONS[(i + 1) % REPEAT_OPTIONS.length];
                  useSettings.getState().setRepeatAyah(next);
                }}
                style={[styles.chip, { borderColor: theme.backgroundSelected }]}
                accessibilityLabel="Repeat count">
                <ThemedText style={styles.chipText}>×{repeatAyah}</ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        {/* Reciter picker */}
        <Modal visible={reciterOpen} transparent animationType="slide" onRequestClose={() => setReciterOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setReciterOpen(false)}>
            <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => {}}>
              <ThemedText style={styles.sheetTitle}>Reciter</ThemedText>
              <FlatList
                data={RECITERS}
                keyExtractor={(r) => r.id}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      useSettings.getState().setReciter(item.id);
                      setReciterOpen(false);
                    }}
                    style={styles.reciterRow}>
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
          </Pressable>
        </Modal>
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
  headerText: { flex: 1, alignItems: 'center' },
  headerRight: { width: 38 },
  surahName: { fontSize: 20, fontWeight: 700, fontFamily: 'Amiri', lineHeight: 28 },
  surahSub: { fontSize: 12 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  basmala: {
    fontFamily: 'Amiri',
    textAlign: 'center',
    lineHeight: 44,
    marginBottom: Spacing.three,
    color: Brand.gold,
  },
  ayah: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 10,
    marginBottom: Spacing.one,
  },
  ayahText: {
    fontFamily: 'Amiri',
    textAlign: 'right',
    lineHeight: 52,
    writingDirection: 'rtl',
  },
  sajda: { fontSize: 26 },
  ayahEnd: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  ayahEndNumber: { fontSize: 14, color: Brand.gold, fontFamily: 'Amiri' },
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
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.four, maxHeight: '70%' },
  sheetTitle: { fontSize: 20, fontWeight: 700, marginBottom: Spacing.two },
  reciterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.three, gap: Spacing.two },
  reciterText: { flex: 1 },
  reciterName: { fontSize: 16, fontWeight: 600 },
  reciterNote: { fontSize: 12 },
});
