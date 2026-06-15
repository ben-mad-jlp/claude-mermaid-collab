import { getSecret } from '../../../src/services/config-service.ts';

/**
 * xAI (Grok) Text-to-Speech provider. VERIFIED live 2026-06-15.
 *   POST https://api.x.ai/v1/tts
 *   body: { text, language, voice_id, output_format:{codec,sample_rate,bit_rate}, speed, with_timestamps }
 *   → raw audio bytes (Content-Type audio/*); with_timestamps → { audio(b64), content_type, duration, audio_timestamps }
 *   Voices: eve (default), ara, rex, sal, leo. ~$4.20 / 1M chars.
 */
const ENDPOINT = 'https://api.x.ai/v1/tts';
export const TTS_VOICES = ['eve', 'ara', 'rex', 'sal', 'leo'] as const;
export type TtsVoice = typeof TTS_VOICES[number];
const USD_PER_CHAR = 4.2e-6;

export interface TtsOptions {
  voiceId?: TtsVoice | string;
  language?: string;        // BCP-47 or 'auto'. Default 'en'.
  codec?: 'mp3' | 'wav' | 'pcm';
  sampleRate?: number;      // default 44100
  bitRate?: number;         // mp3 only, default 128000
  speed?: number;           // 0.7–1.5, default 1.0
}

export interface TtsResult {
  bytes: Uint8Array;
  mimeType: string;
  costUsd: number;
  voiceId: string;
  chars: number;
}

export async function synthesizeSpeech(text: string, opts: TtsOptions = {}): Promise<TtsResult> {
  const apiKey = getSecret('XAI_API_KEY') ?? process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set (checked config.json via getSecret and env).');
  const codec = opts.codec ?? 'mp3';
  const body: Record<string, unknown> = {
    text,
    language: opts.language ?? 'en',
    voice_id: opts.voiceId ?? 'eve',
    output_format: { codec, sample_rate: opts.sampleRate ?? 44100, ...(codec === 'mp3' ? { bit_rate: opts.bitRate ?? 128000 } : {}) },
  };
  if (opts.speed != null) body.speed = opts.speed;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`xAI TTS failed: ${res.status} ${res.statusText} ${t}`.trim());
  }
  const mimeType = res.headers.get('content-type') || (codec === 'wav' ? 'audio/wav' : 'audio/mpeg');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mimeType, costUsd: text.length * USD_PER_CHAR, voiceId: String(body.voice_id), chars: text.length };
}
