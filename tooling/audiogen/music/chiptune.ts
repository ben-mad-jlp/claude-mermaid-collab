import { encodeWav } from '../wav.ts';

/**
 * Compact chiptune renderer (pure JS) — NES-ish square/triangle/noise channels.
 * Grok's TEXT model composes the symbolic PATTERN; this synthesizes it to a WAV.
 * Beat-timed notes; loopable. Deterministic.
 */
export interface ChiptuneNote { note: number | string; start: number; dur: number; vol?: number } // MIDI# or 'C4'; start/dur in beats
export interface ChiptuneChannel { wave?: 'square' | 'triangle' | 'saw' | 'noise'; duty?: number; notes: ChiptuneNote[] }
export interface ChiptunePattern { bpm?: number; beats?: number; channels: ChiptuneChannel[]; masterVol?: number }

const SR = 44100;
const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midiOf(note: number | string): number {
  if (typeof note === 'number') return note;
  const m = NOTE_RE.exec(note.trim());
  if (!m) return 60;
  let s = SEMI[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return s + (parseInt(m[3], 10) + 1) * 12;
}
const freqOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function renderChiptune(pat: ChiptunePattern): Buffer {
  const bpm = pat.bpm ?? 120;
  const spb = 60 / bpm; // seconds per beat
  const totalBeats = pat.beats ?? Math.max(1, ...pat.channels.flatMap((c) => c.notes.map((n) => n.start + n.dur)));
  const n = Math.ceil(totalBeats * spb * SR);
  const out = new Float32Array(n);
  const master = pat.masterVol ?? 0.5;
  let rng = 0x1234567;
  const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return ((rng >>> 0) / 0xffffffff) * 2 - 1; };

  for (const ch of pat.channels) {
    const wave = ch.wave ?? 'square';
    const duty = ch.duty ?? 0.5;
    for (const note of ch.notes) {
      const f = freqOf(midiOf(note.note));
      const start = Math.floor(note.start * spb * SR);
      const len = Math.max(1, Math.floor(note.dur * spb * SR));
      const vol = (note.vol ?? 0.8);
      let phase = 0, nz = 0;
      for (let i = 0; i < len; i++) {
        const idx = start + i; if (idx < 0 || idx >= n) continue;
        // short attack + decay envelope to avoid clicks + give pluck
        const tt = i / len;
        const env = Math.min(1, i / (SR * 0.005)) * Math.max(0, 1 - tt * 0.9);
        phase += f / SR; if (phase >= 1) phase -= 1;
        let s: number;
        switch (wave) {
          case 'triangle': s = 4 * Math.abs(phase - 0.5) - 1; break;
          case 'saw': s = 2 * phase - 1; break;
          case 'noise': if (i % 32 === 0) nz = rnd(); s = nz; break;
          case 'square': default: s = phase < duty ? 1 : -1; break;
        }
        out[idx] += s * env * vol * 0.4;
      }
    }
  }
  // soft clip + master
  for (let i = 0; i < n; i++) { const x = out[i] * master; out[i] = Math.tanh(x); }
  return encodeWav(out, SR, 1);
}
