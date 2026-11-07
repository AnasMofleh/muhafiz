# Muhafiz — مُحافِظ

**Muhafiz** (Arabic: "keeper, guardian") is a Quran memorization companion app that replaces doomscrolling with a guided daily practice.

- 🗓️ **A plan that works for you** — goal-based memorization plan (new lesson *sabaq*, recent review *sabaqi*, long-term revision *manzil*) with spaced repetition and smart local reminders.
- 🎮 **Gamified memorization modes** — flashcards, hide-next-ayah (recite before revealing), scratch-to-reveal, and quizzes.
- 🎧 **Listen** — multiple reciters (Alafasy, Husary, Minshawi, Maher Al Muaiqly, …), ayah-by-ayah playback, 0.5×–2× speed.
- 🎙️ **Recitation checking** — record yourself reciting and get corrected against the Hafs 'an 'Asim riwaya (AI speech-to-text + fuzzy matching).
- 🗺️ **Learning path** — a visual journey showing how far you've come and what's left.
- 🤝 **Journey together** — challenges and share cards you can send to friends on WhatsApp.

## Platforms

- **Android / iPhone** — Expo / React Native app (Expo Go for development, standalone APK via EAS Build).
- **Desktop web** — the Expo web build, deployed on GitHub Pages at `https://anasmofleh.github.io/muhafiz/`.

## Status

🚧 In active development. See milestones in the repository history and issues.

## Tech stack

- Expo SDK 58 + React Native + TypeScript, Expo Router, NativeWind (Tailwind)
- expo-sqlite (local-first storage), Zustand, expo-notifications, expo-audio, react-native-skia
- Quran text: Tanzil (Hafs, Uthmani script) · Audio: everyayah.com / quran.com CDN · ASR: Groq Whisper (free tier)

## Development

```sh
npm install
npx expo start          # mobile (scan QR with Expo Go)
npx expo start --web    # desktop web
npm run export:web      # static web build (GitHub Pages)
```

## Data & licenses

- Quran text (Uthmani, Hafs) © Tanzil Project, distributed under [CC BY-ND 3.0](https://tanzil.net/docs/terms_of_service) — see `scripts/README.md` for build instructions.
- Recitation audio is streamed from the everyayah.com / quran.com CDNs at runtime; files are not redistributed here.
