// Reciter registry — ayah-level MP3s streamed from everyayah.com (CORS-enabled,
// Range-capable CDN). Files are not redistributed; see in-app licenses.

export type ReciterStyle = 'murattal' | 'mujawwad' | 'teacher';

export interface Reciter {
  id: string;
  name: string;
  arabicName: string;
  folder: string;
  style: ReciterStyle;
  /** Short hint shown in the picker, e.g. "tartil · slow, clear" */
  note?: string;
}

export const RECITERS: Reciter[] = [
  {
    id: 'husary',
    name: 'Mahmoud Khalil Al-Husary',
    arabicName: 'محمود خليل الحصري',
    folder: 'Husary_128kbps',
    style: 'murattal',
    note: 'the classic reference for hifz',
  },
  {
    id: 'husary-muallim',
    name: 'Al-Husary — Muallim (teacher)',
    arabicName: 'الحصري المعلم',
    folder: 'Husary_Muallim_128kbps',
    style: 'teacher',
    note: 'repeats each phrase for learning',
  },
  {
    id: 'minshawy',
    name: 'Muhammad Siddiq Al-Minshawi',
    arabicName: 'محمد صديق المنشاوي',
    folder: 'Minshawy_Murattal_128kbps',
    style: 'murattal',
    note: 'slow, teacher-style tartil',
  },
  {
    id: 'alafasy',
    name: 'Mishary Rashid Alafasy',
    arabicName: 'مشاري راشد العفاسي',
    folder: 'Alafasy_128kbps',
    style: 'murattal',
  },
  {
    id: 'abdulbasit',
    name: 'Abdul Basit — Murattal',
    arabicName: 'عبد الباسط عبد الصمد',
    folder: 'Abdul_Basit_Murattal_192kbps',
    style: 'murattal',
  },
  {
    id: 'sudais',
    name: 'Abdurrahman As-Sudais',
    arabicName: 'عبد الرحمن السديس',
    folder: 'Abdurrahmaan_As-Sudais_192kbps',
    style: 'murattal',
  },
  {
    id: 'maher',
    name: 'Maher Al Muaiqly',
    arabicName: 'ماهر المعيقلي',
    folder: 'MaherAlMuaiqly128kbps',
    style: 'murattal',
  },
  {
    id: 'ayyoub',
    name: 'Muhammad Ayyub',
    arabicName: 'محمد أيوب',
    folder: 'Muhammad_Ayyoub_128kbps',
    style: 'murattal',
  },
];

export function getReciter(id: string): Reciter {
  return RECITERS.find((r) => r.id === id) ?? RECITERS[0];
}

/** e.g. https://everyayah.com/data/Husary_128kbps/002255.mp3 */
export function ayahAudioUrl(reciter: Reciter, surah: number, ayah: number): string {
  const s = String(surah).padStart(3, '0');
  const a = String(ayah).padStart(3, '0');
  return `https://everyayah.com/data/${reciter.folder}/${s}${a}.mp3`;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const REPEAT_OPTIONS = [1, 2, 3, 5] as const;
