import { encodeWav } from '../wav.ts';

/**
 * Compact sfxr-style retro SFX synth (pure JS) — the kind of chiptune blips used for
 * coin/jump/laser/hit/explosion. Grok's TEXT model picks the params from a description;
 * this renders them to a WAV. Faithful subset of the classic sfxr parameter set.
 * All params normalized 0..1 unless noted. Render is deterministic.
 */
export interface SfxrParams {
  wave?: 'square' | 'saw' | 'sine' | 'noise' | 'triangle';
  attack?: number;     // 0..1 seconds-ish (env)
  sustain?: number;    // 0..1
  punch?: number;      // 0..1 sustain volume boost at start
  decay?: number;      // 0..1
  freq?: number;       // 0..1 base pitch
  freqMin?: number;    // 0..1 floor for downward slides
  slide?: number;      // -1..1 pitch slide
  deltaSlide?: number; // -1..1 slide acceleration
  vibratoDepth?: number; // 0..1
  vibratoSpeed?: number; // 0..1
  arpMod?: number;     // -1..1 mid-sound pitch jump
  arpSpeed?: number;   // 0..1 when the jump happens
  duty?: number;       // 0..1 square duty
  dutySweep?: number;  // -1..1
  lowpass?: number;    // 0..1 (1 = open)
  repeat?: number;     // 0..1 retrigger speed
  volume?: number;     // 0..1 master
}

const SR = 44100;

/** Render sfxr params to a mono 16-bit WAV buffer. */
export function renderSfxr(p: SfxrParams): Buffer {
  const wave = p.wave ?? 'square';
  const vol = p.volume ?? 0.5;
  const attack = (p.attack ?? 0) ** 2 * 1.0;
  const sustain = (p.sustain ?? 0.2) ** 2 * 1.0 + 0.01;
  const decay = (p.decay ?? 0.3) ** 2 * 1.2;
  const total = attack + sustain + decay;
  const n = Math.max(1, Math.floor(total * SR));
  const out = new Float32Array(n);

  // freq accepts EITHER a normalized 0..1 value OR a raw Hz value (>1) — models often
  // emit Hz despite the 0..1 contract, so be tolerant.
  const toHz = (v: number | undefined, normMax: number, floor: number) =>
    v == null ? floor : (v > 1 ? v : floor + v ** 2 * normMax);
  const baseFreq = Math.min(12000, toHz(p.freq, 2000, 50));
  const minFreq = Math.min(baseFreq, toHz(p.freqMin, 1000, 30));
  let slide = (p.slide ?? 0) * 0.5;
  const deltaSlide = (p.deltaSlide ?? 0) * 0.01;
  const duty0 = 0.5 - (p.duty ?? 0.5) * 0.5;
  const dutySweep = (p.dutySweep ?? 0) * 1e-5;
  const vibDepth = (p.vibratoDepth ?? 0) * 0.5;
  const vibSpeed = (p.vibratoSpeed ?? 0) * 0.1;
  const arpSpeed = p.arpSpeed ? Math.floor((1 - (p.arpSpeed)) * total * SR) : 0;
  const arpMul = 1 + (p.arpMod ?? 0) * 1.5;
  const lowpass = (p.lowpass ?? 1);
  const repeatN = p.repeat ? Math.floor((1 - p.repeat) * total * SR) : 0;

  let freq = baseFreq, phase = 0, duty = duty0, lpPrev = 0, noise = 0;
  let rng = 0x2545f491;
  const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return ((rng >>> 0) / 0xffffffff) * 2 - 1; };

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // envelope
    let env: number;
    if (t < attack) env = t / attack;
    else if (t < attack + sustain) env = 1 + (p.punch ?? 0) * 2 * (1 - (t - attack) / sustain);
    else env = Math.max(0, 1 - (t - attack - sustain) / decay);

    // pitch slide + vibrato + arpeggio + repeat
    if (repeatN && i % repeatN === 0) { freq = baseFreq; }
    if (arpSpeed && i === arpSpeed) freq *= arpMul;
    slide += deltaSlide;
    freq = Math.max(minFreq, freq * (1 + slide / SR * 8));
    const vib = vibDepth ? 1 + vibDepth * Math.sin(2 * Math.PI * (vibSpeed * SR) * t / 100) : 1;
    const f = freq * vib;
    duty = Math.min(0.98, Math.max(0.02, duty + dutySweep));

    phase += f / SR;
    if (phase >= 1) phase -= 1;
    let s: number;
    switch (wave) {
      case 'square': s = phase < duty ? 1 : -1; break;
      case 'saw': s = 2 * phase - 1; break;
      case 'triangle': s = 4 * Math.abs(phase - 0.5) - 1; break;
      case 'sine': s = Math.sin(2 * Math.PI * phase); break;
      case 'noise': default: if (phase < f / SR + 1e-9 || i === 0) noise = rnd(); s = noise; break;
    }
    // simple one-pole lowpass
    lpPrev = lpPrev + (s - lpPrev) * (0.05 + lowpass * 0.95);
    out[i] = lpPrev * env * vol;
  }
  return encodeWav(out, SR, 1);
}
