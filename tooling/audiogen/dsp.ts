/**
 * Shared audio DSP / preset layer (game-audio toolkit).
 *
 * One filter engine applied UNIFORMLY to voiceover, SFX, and music (the cohesion
 * requirement): named presets are ffmpeg `-af` filterchains run through the BUNDLED
 * ffmpeg (no extra deps; works in the compiled sidecar). Compose presets by chaining.
 *
 * Effects used: pitch (asetrate+atempo, preserves tempo), formant/size, reverb (aecho),
 * bitcrush (acrusher), grit (acrusher log / overdrive), EQ (bass/treble), compression +
 * loudnorm, layering an octave-down copy (amix) for an "epic doubled" body.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath, hasFfmpeg } from '../imagegen/pipeline/frames.ts';

const execFileAsync = promisify(execFile);

/** Named filterchains. `${SR}` is replaced with the working sample rate. */
export const DSP_PRESETS: Record<string, string> = {
  'epic-announcer': "asetrate=${SR}*0.92,aresample=${SR},atempo=1.087,aecho=0.8:0.88:80|150:0.4|0.25,bass=g=5,acompressor=threshold=-18dB:ratio=4,loudnorm=I=-14",
  'ice-demon': "asetrate=${SR}*0.78,aresample=${SR},atempo=1.282,aecho=0.8:0.9:120|250:0.5|0.35,acrusher=bits=8:mode=log:aa=1,bass=g=6,loudnorm=I=-14",
  'giant': "asetrate=${SR}*0.7,aresample=${SR},atempo=1.428,bass=g=7,loudnorm=I=-14",
  'imp': "asetrate=${SR}*1.4,aresample=${SR},atempo=0.714,treble=g=3,loudnorm=I=-14",
  'robot-8bit': "acrusher=bits=6:samples=4:mode=log,highpass=f=300,lowpass=f=4000,acompressor=threshold=-16dB:ratio=6,loudnorm=I=-14",
  'bitcrush': "acrusher=bits=8:samples=2:mode=log:aa=1,loudnorm=I=-14",
  'radio': "highpass=f=400,lowpass=f=3400,acompressor=threshold=-16dB:ratio=5,loudnorm=I=-16",
  'ghost': "aecho=0.8:0.9:200|400|600:0.5|0.35|0.2,asetrate=${SR}*0.95,aresample=${SR},atempo=1.052,loudnorm=I=-16",
  'hype': "bass=g=4,treble=g=3,acompressor=threshold=-20dB:ratio=6,loudnorm=I=-12",
  'arena': "aecho=0.85:0.9:90|180|300:0.4|0.3|0.2,loudnorm=I=-14",
  'master-8bit': "acrusher=bits=10:samples=2:mode=log:aa=1,loudnorm=I=-14",
};

export interface DspOptions {
  /** A preset name from DSP_PRESETS, OR a raw ffmpeg -af filterchain. */
  preset?: string;
  /** Working sample rate substituted into presets. Default 44100. */
  sampleRate?: number;
  /** Output codec: 'mp3' | 'wav'. Default keeps input container (mp3). */
  codec?: 'mp3' | 'wav';
}

/** Resolve a preset name (or pass through a raw chain) to a concrete -af string. */
export function resolveChain(presetOrChain: string, sampleRate = 44100): string {
  const chain = DSP_PRESETS[presetOrChain] ?? presetOrChain;
  return chain.replace(/\$\{SR\}/g, String(sampleRate));
}

/** Apply a DSP preset/filterchain to an audio buffer via ffmpeg. Returns the processed audio. */
export async function applyChain(input: Buffer | Uint8Array, opts: DspOptions): Promise<Buffer> {
  if (!opts.preset) return Buffer.from(input);
  if (!(await hasFfmpeg())) throw new Error('ffmpeg not found — required for audio DSP.');
  const sr = opts.sampleRate ?? 44100;
  const af = resolveChain(opts.preset, sr);
  const codec = opts.codec ?? 'mp3';
  const dir = await mkdtemp(join(tmpdir(), 'audiodsp-'));
  try {
    const inPath = join(dir, 'in'); const outPath = join(dir, `out.${codec}`);
    await writeFile(inPath, Buffer.from(input));
    await execFileAsync(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-y', '-i', inPath, '-af', af, outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function listPresets(): string[] { return Object.keys(DSP_PRESETS); }
