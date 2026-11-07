import { Platform } from 'react-native';

import { DAILY_ASR_QUOTA, useAsrStore } from '@/store/asr';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export type AsrErrorCode =
  | 'missing-key'
  | 'too-short'
  | 'unavailable'
  | 'quota'
  | 'request-failed';

/** Error with a message that is safe to show directly in the UI. */
export class AsrError extends Error {
  readonly code: AsrErrorCode;

  constructor(code: AsrErrorCode, message: string) {
    super(message);
    this.name = 'AsrError';
    this.code = code;
  }
}

/** Minimal shape of an expo-audio recording on native or web. */
export type RecordingInput = { uri: string; mimeType: string } | { blob: Blob };

const MISSING_KEY_MESSAGE = 'Check your Groq API key in settings';
const TOO_SHORT_MESSAGE = 'Recording too short';
const UNAVAILABLE_MESSAGE = 'Speech recognition unavailable on this browser';

// ---------------------------------------------------------------------------
// Browser SpeechRecognition fallback (Groq may fail CORS on the web build)
// ---------------------------------------------------------------------------

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript?: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (Platform.OS !== 'web') return null;

  const scope = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function recognizeWithBrowser(): Promise<string> {
  const Recognition = getSpeechRecognitionConstructor();

  if (!Recognition) {
    return Promise.reject(new AsrError('unavailable', UNAVAILABLE_MESSAGE));
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let recognition: SpeechRecognitionLike;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        reject(new AsrError('unavailable', UNAVAILABLE_MESSAGE));
      });
    }, 15000);

    try {
      recognition = new Recognition();
    } catch {
      clearTimeout(timeout);
      reject(new AsrError('unavailable', UNAVAILABLE_MESSAGE));
      return;
    }

    recognition.lang = 'ar-SA';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? '';

      if (transcript) {
        finish(() => resolve(transcript));
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        finish(() => reject(new AsrError('too-short', TOO_SHORT_MESSAGE)));
      } else {
        finish(() => reject(new AsrError('unavailable', UNAVAILABLE_MESSAGE)));
      }
    };

    recognition.onend = () => {
      finish(() => reject(new AsrError('too-short', TOO_SHORT_MESSAGE)));
    };

    try {
      recognition.start();
    } catch {
      finish(() => reject(new AsrError('unavailable', UNAVAILABLE_MESSAGE)));
    }
  });
}

// ---------------------------------------------------------------------------
// Groq Whisper
// ---------------------------------------------------------------------------

function buildFormData(recording: RecordingInput, targetAyahText: string): FormData {
  const form = new FormData();

  if ('blob' in recording) {
    const mimeType = recording.blob.type || 'audio/webm';
    const extension = mimeType.includes('mp4')
      ? 'm4a'
      : mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm';
    form.append('file', recording.blob, `audio.${extension}`);
  } else {
    // React Native's FormData accepts this file descriptor shape.
    form.append(
      'file',
      {
        uri: recording.uri,
        name: 'audio',
        type: recording.mimeType || 'audio/m4a',
      } as unknown as Blob
    );
  }

  form.append('model', 'whisper-large-v3');
  form.append('language', 'ar');
  form.append('temperature', '0');
  form.append('prompt', targetAyahText);
  form.append('response_format', 'json');

  return form;
}

async function transcribeWithGroq(form: FormData, apiKey: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new AsrError(
      'request-failed',
      'Could not reach the transcription service. Check your connection and try again.'
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AsrError('missing-key', MISSING_KEY_MESSAGE);
    }
    if (response.status === 429) {
      throw new AsrError(
        'quota',
        'Groq rate limit reached. Try again later, or grade yourself below.'
      );
    }
    throw new AsrError(
      'request-failed',
      `Transcription failed (${response.status}). Please try again.`
    );
  }

  let data: { text?: string };

  try {
    data = (await response.json()) as { text?: string };
  } catch {
    throw new AsrError('request-failed', 'Transcription failed. Please try again.');
  }

  const transcript = (data.text ?? '').trim();

  if (!transcript) {
    throw new AsrError('too-short', TOO_SHORT_MESSAGE);
  }

  return transcript;
}

/**
 * Transcribes a recorded ayah with Groq Whisper.
 *
 * Native: sends the recording URI as multipart form data.
 * Web: tries the same Groq request first, then falls back to the browser's
 * speech recognition when Groq is unavailable (for example due to CORS).
 */
export async function transcribe(
  recording: RecordingInput,
  targetAyahText: string
): Promise<string> {
  if ('blob' in recording && recording.blob.size === 0) {
    throw new AsrError('too-short', TOO_SHORT_MESSAGE);
  }
  if ('blob' in recording && recording.blob.size < 1000) {
    throw new AsrError('too-short', TOO_SHORT_MESSAGE);
  }

  const form = buildFormData(recording, targetAyahText);
  const store = useAsrStore.getState();
  const apiKey = store.groqKey.trim();

  if (apiKey) {
    if (!store.canUseQuota()) {
      if (Platform.OS !== 'web') {
        throw new AsrError(
          'quota',
          `Daily word-check limit reached (${DAILY_ASR_QUOTA}/day). Grade yourself below or try again tomorrow.`
        );
      }
      return recognizeWithBrowser();
    }

    try {
      const transcript = await transcribeWithGroq(form, apiKey);
      useAsrStore.getState().recordCheck();
      return transcript;
    } catch (error) {
      // On the web Groq can fail because of CORS; use the browser fallback.
      if (Platform.OS !== 'web') throw error;
    }
  }

  if (Platform.OS !== 'web') {
    throw new AsrError('missing-key', MISSING_KEY_MESSAGE);
  }

  return recognizeWithBrowser();
}
