import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import type { SurahData } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';

const BASMALA_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

export type MushafLayout = 'lines' | 'flow' | 'pages';
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

function toArabicIndic(number: number): string {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(number)
    .split('')
    .map((d) => digits[Number(d)] ?? d)
    .join('');
}

/**
 * Mushaf-authentic ayah-end marker: ﴿n﴾ (ornamental parens, Arabic-Indic
 * number), gold, inline with the text.
 */
function AyahMarker({
  number,
  gold,
  fontScale,
  onPress,
  testID,
}: {
  number: number;
  gold: string;
  fontScale: number;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <RNText
      testID={testID}
      onPress={onPress}
      suppressHighlighting={!onPress}
      style={[
        styles.marker,
        { color: gold, fontSize: 15 * fontScale, lineHeight: 28 * fontScale },
      ]}>
      {'﴿'}
      {toArabicIndic(number)}
      {'﴾'}
    </RNText>
  );
}

/**
 * Shared mushaf renderer: per-ayah "lines" layout, continuous "flow"
 * (mushaf-style text with inline ayah markers), or "pages" (grouped by the
 * 604-page mushaf, each page framed like the printed mushaf).
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
  // Fully hidden (invisible), not blurred — layout is preserved.
  const hideStyle = { opacity: 0 };

  const basmala = showBasmala ? (
    <ThemedText
      style={[
        styles.basmala,
        { fontSize: 24 * fontScale, lineHeight: 46 * fontScale, color: gold },
      ]}>
      {BASMALA_TEXT}
    </ThemedText>
  ) : null;

  // Continuous flow text for a set of ayahs (used by flow + pages modes).
  const renderFlowText = (list: typeof ayahs) => (
    <ThemedText
      style={[
        styles.flowText,
        {
          fontSize: ayahFontSize,
          lineHeight: ayahLineHeight,
          color: textColorResolved,
        },
      ]}>
      {list.map((ayah) => {
        const hidden = isHidden(ayah.number);
        const isCurrent = currentAyah === ayah.number;
        return (
          <RNText key={ayah.number}>
            <RNText style={hidden ? hideStyle : undefined}>
              {ayah.text_uthmani}
              {ayah.sajda ? ' ۩' : ''}
              {'  '}
            </RNText>
            <RNText style={hidden ? hideStyle : undefined}>
              <AyahMarker
                number={ayah.number}
                gold={gold}
                fontScale={fontScale}
                testID={`${testIDPrefix}-${ayah.number}`}
                onPress={onAyahTap ? () => onAyahTap?.(ayah.number) : undefined}
              />
            </RNText>
            {isCurrent && !hidden ? (
              <RNText style={[styles.currentDot, { backgroundColor: highlight }]}>{' '}</RNText>
            ) : null}
          </RNText>
        );
      })}
    </ThemedText>
  );

  if (layout === 'flow') {
    return (
      <View
        style={[styles.flowWrap, parchment && { backgroundColor: parchmentBg }]}
        testID={`${testIDPrefix}-flow`}>
        {basmala}
        {renderFlowText(ayahs)}
      </View>
    );
  }

  if (layout === 'pages') {
    // Group by the 604-page mushaf; each page is framed like a printed page.
    const pages: { page: number; list: typeof ayahs }[] = [];
    for (const ayah of ayahs) {
      const last = pages[pages.length - 1];
      if (last && last.page === ayah.page) {
        last.list.push(ayah);
      } else {
        pages.push({ page: ayah.page, list: [ayah] });
      }
    }
    return (
      <View style={styles.pagesWrap}>
        {pages.map(({ page, list }) => (
          <View
            key={page}
            testID={`${testIDPrefix}-page-${page}`}
            style={[
              styles.pageFrame,
              parchment && { backgroundColor: parchmentBg },
              { borderColor: isDark ? Brand.goldDark : Brand.gold },
            ]}>
            {page === pages[0].page && showBasmala ? basmala : null}
            {renderFlowText(list)}
            <ThemedText style={[styles.pageNumber, { color: gold }]}>
              {'صفحة '}
              {toArabicIndic(page)}
              {' · Page '}
              {page}
            </ThemedText>
          </View>
        ))}
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
              {' '}
              <AyahMarker number={ayah.number} gold={gold} fontScale={fontScale} />
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
  pagesWrap: { gap: 16 },
  pageFrame: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  pageNumber: {
    fontFamily: 'Amiri',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
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
  marker: {
    fontFamily: 'Amiri',
    textAlign: 'center',
  },
  currentDot: {
    borderRadius: 999,
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
});
