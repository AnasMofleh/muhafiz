import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { useSettings, type FlashcardSection } from '@/store/settings';

/**
 * Shared section/order options for Flashcards and Quiz: section chips
 * (today / surah / juz / learned) with surah/juz steppers and a random
 * toggle. Reads and writes the settings store directly.
 */
export function PracticeOptions() {
  const theme = useTheme();
  const t = useT();
  const {
    flashcardSection,
    flashcardSurah,
    flashcardJuz,
    flashcardRandom,
    setFlashcardSection,
    setFlashcardSurah,
    setFlashcardJuz,
    setFlashcardRandom,
  } = useSettings();

  const sections: [FlashcardSection, string][] = [
    ['today', t('flashcards.sectionToday')],
    ['surah', t('flashcards.sectionSurah')],
    ['juz', t('flashcards.sectionJuz')],
    ['learned', t('flashcards.sectionLearned')],
  ];

  return (
    <View style={[styles.optionsCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.optionLabel} themeColor="textSecondary">
        {t('flashcards.section')}
      </ThemedText>
      <View style={styles.optionRow}>
        {sections.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFlashcardSection(key)}
            style={[
              styles.optionChip,
              {
                borderColor: flashcardSection === key ? Brand.emerald : theme.backgroundSelected,
                backgroundColor: flashcardSection === key ? Brand.emeraldSoft : 'transparent',
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: flashcardSection === key }}
            testID={`fc-section-${key}`}>
            <ThemedText
              type="smallBold"
              style={{ color: flashcardSection === key ? Brand.emeraldDark : theme.text }}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {flashcardSection === 'surah' ? (
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => setFlashcardSurah(Math.max(1, flashcardSurah - 1))}
            style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Previous surah">
            <Ionicons name="remove" size={16} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold" testID="fc-surah-value">
            {t('common.surah')} {flashcardSurah}
          </ThemedText>
          <Pressable
            onPress={() => setFlashcardSurah(Math.min(114, flashcardSurah + 1))}
            style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Next surah">
            <Ionicons name="add" size={16} color={theme.text} />
          </Pressable>
        </View>
      ) : null}
      {flashcardSection === 'juz' ? (
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => setFlashcardJuz(Math.max(1, flashcardJuz - 1))}
            style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Previous juz">
            <Ionicons name="remove" size={16} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold" testID="fc-juz-value">
            Juz {flashcardJuz}
          </ThemedText>
          <Pressable
            onPress={() => setFlashcardJuz(Math.min(30, flashcardJuz + 1))}
            style={[styles.stepBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Next juz">
            <Ionicons name="add" size={16} color={theme.text} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.randomRow}>
        <ThemedText style={styles.optionLabel} themeColor="textSecondary">
          {t('flashcards.order')}
        </ThemedText>
        <Pressable
          onPress={() => setFlashcardRandom(!flashcardRandom)}
          style={[
            styles.optionChip,
            {
              borderColor: flashcardRandom ? Brand.gold : theme.backgroundSelected,
              backgroundColor: flashcardRandom ? Brand.goldSoft : 'transparent',
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: flashcardRandom }}
          testID="fc-random-toggle">
          <Ionicons
            name={flashcardRandom ? 'shuffle' : 'swap-vertical-outline'}
            size={14}
            color={flashcardRandom ? Brand.goldDark : theme.text}
          />
          <ThemedText
            type="smallBold"
            style={{ color: flashcardRandom ? Brand.goldDark : theme.text }}>
            {flashcardRandom ? t('flashcards.orderRandom') : t('flashcards.orderSequential')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  optionsCard: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.three },
  optionLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  randomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
