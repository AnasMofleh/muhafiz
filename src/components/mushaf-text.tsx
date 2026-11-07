import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';

const BASMALA_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

export type MushafLayout = 'lines' | 'flow';
export type MushafTextColor = 'classic' | 'green' | 'gold' | 'teal';

interface MushafTextProps {
  surah: SurahData;
  /** Inclusive ayah range; defaults to the whole surah. */
  fromAyah?: number;
  toAyah?: number;
  layout: MushafLayout;
  textColor: MushafTextColor;
  parchment: boolean;
  fontScale: number;
  /** Ayah highlighted as the "current" one (playing / reciting). */
  currentAyah?: number;
  /** Ayahs rendered blurred until tapped (hide-next / reveal-as-you-go). */
  hiddenAyahs?: Set<number>;
  /** Tap on an ayah block (lines mode) or its inline number (flow mode). */
  onAyahTap?: (ayahNumber: number) => void;
  testIDPrefix?: string;
}

function resolveTextColor(
  textColor: MushafTextColor,
  isDark: boolean,
  themeText: string
): string {
  switch (textColor) {
    case 'green':
      return isDark ? '#6FBF7F' : Brand.emerald;
    case 'gold':
      return isDark ? Brand.gold : Brand.goldDark;
    case 'teal':
      return isDark ? '#7FB4CC' : Brand.teal;
    default:
      return themeText;
  }
}

/**
 * Shared mushaf renderer: per-ayah "lines" layout or continuous "flow"
 * (mushaf-style text with inline ayah markers). Used by the mushaf screen,
 * Hide & Recite and the Recite stream.
 */
export function MushafText({
  surah,
  fromAyah = 1,
  toAyah = surah.ayahCount,
  layout,
  textColor,
  parchment,
  fontScale,
  currentAyah,
  hiddenAyahs,
  onAyahTap,
  testIDPrefix = 'ayah',
}: MushafTextProps) {
  const isDark = useColorScheme() === 'dark';
  const ayahs = surah.ayahs.filter(
    (a) => a.number >= Math.max(1, fromAyah) && a.number <= Math.min(surah.ayahCount, toAyah)
  );
  const textColorResolved = resolveTextColor(textColor, isDark, isDark ? '#ffffff' : '#000000');
  const highlight = isDark ? '#1E3B33' : '#EFE0B5';
  const parchmentBg = isDark ? '#26221A' : '#FBF3DD';
  const showBasmala = fromAyah === 1 && surah.ayahs[0]?.basmalaStripped === true;

  const gold = isDark ? Brand.gold : Brand.goldDark;
  const ayahFontSize = 26 * fontScale;
  const ayahLineHeight = 52 * fontScale;

  const isHidden = (n: number) => Boolean(hiddenAyahs?.has(n));
  const hideStyle = { opacity: 0.08 };

  const basmala = showBasmala ? (
    <ThemedText
      style={[
        styles.basmala,
        { fontSize: 24 * fontScale, lineHeight: 46 * fontScale, color: gold },
      ]}>
      {BASMALA_TEXT}
    </ThemedText>
  ) : null;

  if (layout === 'flow') {
    return (
      <View
        style={[styles.flowWrap, parchment && { backgroundColor: parchmentBg }]}
        testID={`${testIDPrefix}-flow`}>
        {basmala}
        <ThemedText
          style={[
            styles.flowText,
            {
              fontSize: ayahFontSize,
              lineHeight: ayahLineHeight,
              color: textColorResolved,
              backgroundColor: parchment ? 'transparent' : undefined,
            },
          ]}>
          {ayahs.map((ayah) => {
            const hidden = isHidden(ayah.number);
            const isCurrent = currentAyah === ayah.number;
            return (
              <RNText key={ayah.number}>
                <RNText style={hidden ? hideStyle : undefined}>
                  {ayah.text_uthmani}
                  {ayah.sajda ? ' ۩' : ''}
                  {'  '}
                </RNText>
                <RNText
                  testID={`${testIDPrefix}-${ayah.number}`}
                  onPress={hidden ? () => onAyahTap?.(ayah.number) : onAyahTap ? () => onAyahTap?.(ayah.number) : undefined}
                  suppressHighlighting={!onAyahTap}
                  style={[
                    styles.flowMarker,
                    {
                      borderColor: gold,
                      color: gold,
                      fontSize: 15 * fontScale,
                      width: 28 * fontScale,
                      height: 28 * fontScale,
                      lineHeight: 26 * fontScale,
                      borderRadius: 14 * fontScale,
                    },
                    isCurrent && { backgroundColor: highlight, color: Brand.emerald },
                    hidden && hideStyle,
                  ]}>
                  {ayah.number}
                </RNText>
                {' '}
              </RNText>
            );
          })}
        </ThemedText>
      </View>
    );
  }

  // Lines layout — one block per ayah, matching the classic mushaf screen.
  return (
    <View style={[styles.linesWrap, parchment && { backgroundColor: parchmentBg }]}>
      {basmala}
      {ayahs.map((ayah) => {
        const hidden = isHidden(ayah.number);
        const isCurrent = currentAyah === ayah.number;
        return (
          <Pressable
            key={ayah.number}
            testID={`${testIDPrefix}-${ayah.number}`}
            accessibilityRole="button"
            accessibilityLabel={`Ayah ${ayah.number}${isCurrent ? ', playing' : ''}`}
            accessibilityState={{ selected: isCurrent }}
            onPress={() => onAyahTap?.(ayah.number)}
            style={[styles.ayahBlock, isCurrent && { backgroundColor: highlight }, hidden && hideStyle]}>
            <ThemedText
              style={[
                styles.ayahText,
                { fontSize: ayahFontSize, lineHeight: ayahLineHeight, color: textColorResolved },
              ]}
              selectable>
              {ayah.text_uthmani}
              {ayah.sajda ? (
                <ThemedText style={[styles.sajda, { fontSize: ayahFontSize }]} themeColor="textSecondary">
                  {' ۩'}
                </ThemedText>
              ) : null}
              <RNText>
                <ThemedText
                  style={[
                    styles.ayahEnd,
                    {
                      borderColor: gold,
                      width: 30 * fontScale,
                      height: 30 * fontScale,
                      borderRadius: 15 * fontScale,
                    },
                  ]}>
                  <ThemedText style={[styles.ayahEndNumber, { color: gold, fontSize: 14 * fontScale }]}>
                    {ayah.number}
                  </ThemedText>
                </ThemedText>
              </RNText>
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flowWrap: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  linesWrap: {
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  basmala: {
    fontFamily: 'Amiri',
    textAlign: 'center',
    marginBottom: 12,
  },
  flowText: {
    fontFamily: 'Amiri',
    fontWeight: '400',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  flowMarker: {
    fontFamily: 'Amiri',
    textAlign: 'center',
    borderWidth: 1.5,
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
  ayahBlock: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  ayahText: {
    fontFamily: 'Amiri',
    fontWeight: '400',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sajda: { fontFamily: 'Amiri' },
  ayahEnd: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  ayahEndNumber: { fontFamily: 'Amiri' },
});
