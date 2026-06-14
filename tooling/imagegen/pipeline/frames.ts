import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let ffmpegChecked: boolean | null = null;

/** True if an `ffmpeg` binary is callable on this host. Cached after first check. */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    await execFileAsync('ffmpeg', ['-version']);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

export interface ExtractFramesOptions {
  /** Total frames to extract, evenly spaced across the clip (mutually exclusive with fps). */
  count?: number;
  /** Frames per second to extract (used when count is omitted). */
  fps?: number;
  /** Optional cap on output frame width (height auto). */
  maxWidth?: number;
}

/**
 * Demux an mp4 buffer into PNG frame buffers via ffmpeg.
 * Throws a clear error if ffmpeg is not installed (it is NOT bundled with the sidecar yet).
 */
export async function extractFrames(mp4: Buffer | Uint8Array, opts: ExtractFramesOptions = {}): Promise<Buffer[]> {
  if (!(await hasFfmpeg())) {
    throw new Error('ffmpeg not found on PATH — required to extract video frames. Install ffmpeg (brew install ffmpeg) or bundle it with the sidecar.');
  }
  const dir = await mkdtemp(join(tmpdir(), 'spriteframes-'));
  try {
    const inPath = join(dir, 'in.mp4');
    await writeFile(inPath, Buffer.from(mp4));

    // Build the -vf filter. count => sample N evenly over the clip; else fps.
    const filters: string[] = [];
    if (opts.count && opts.count > 0) {
      // probe duration to compute an even fps for exactly ~count frames
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inPath]).catch(() => ({ stdout: '8' }));
      const dur = Math.max(0.1, parseFloat(String(stdout).trim()) || 8);
      filters.push(`fps=${opts.count}/${dur}`);
    } else {
      filters.push(`fps=${opts.fps ?? 8}`);
    }
    if (opts.maxWidth) filters.push(`scale='min(${opts.maxWidth},iw)':-1`);

    await execFileAsync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', inPath, '-vf', filters.join(','), join(dir, 'f%04d.png')]);

    const files = (await readdir(dir)).filter((f) => /^f\d+\.png$/.test(f)).sort();
    let frames = await Promise.all(files.map((f) => readFile(join(dir, f))));
    // count can overshoot by 1 due to rounding; trim to the requested count.
    if (opts.count && frames.length > opts.count) frames = frames.slice(0, opts.count);
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
