import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { getIndex } from '@/data/quran';
import { useTheme } from '@/hooks/use-theme';

export default function SurahListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const index = getIndex();

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <View>
            <ThemedText style={styles.appName}>Muhafiz</ThemedText>
            <ThemedText style={styles.appSub} themeColor="textSecondary">
              Hafs · {index.ayahCount} ayahs · 114 surahs
            </ThemedText>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        <FlatList
          data={index.surahs}
          keyExtractor={(s) => String(s.number)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/surah/[id]', params: { id: String(item.number) } })}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.backgroundElement },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={styles.medallion}>
                <ThemedText style={styles.medallionText}>{item.number}</ThemedText>
              </View>
              <View style={styles.rowText}>
                <ThemedText style={styles.arabicName}>{item.name}</ThemedText>
                <ThemedText style={styles.englishName} themeColor="textSecondary">
                  {item.englishName} · {item.englishNameTranslation}
                </ThemedText>
              </View>
              <View style={styles.rowMeta}>
                <ThemedText style={styles.ayahCount} themeColor="textSecondary">
                  {item.ayahCount}
                </ThemedText>
                <ThemedText style={styles.ayahLabel} themeColor="textSecondary">
                  {item.revelationType === 'Meccan' ? 'Meccan' : 'Medinan'}
                </ThemedText>
              </View>
            </Pressable>
          )}
        />
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  appName: { fontSize: 28, fontWeight: 700, color: Brand.emerald, fontFamily: Fonts.sans },
  appSub: { fontSize: 13, marginTop: 2 },
  iconBtn: {
    padding: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  medallion: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.emerald,
  },
  medallionText: { color: '#fff', fontSize: 15, fontWeight: 700 },
  rowText: { flex: 1 },
  arabicName: { fontSize: 20, fontFamily: 'Amiri', textAlign: 'right', lineHeight: 28 },
  englishName: { fontSize: 13, marginTop: 1 },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  ayahCount: { fontSize: 14, fontWeight: 700 },
  ayahLabel: { fontSize: 11 },
});
