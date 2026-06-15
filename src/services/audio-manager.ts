/**
 * Audio artifact store (game-audio toolkit) — parallel to ImageManager.
 * Stores generated audio (mp3/wav/ogg/midi) as session artifacts under
 * <project>/.collab/sessions/<session>/audio/. Self-contained (own mime allow-list).
 */
import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, basename } from 'path';

const ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
  'audio/midi', 'audio/x-midi', 'application/octet-stream',
]);
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/midi': 'mid', 'audio/x-midi': 'mid',
};

export interface AudioMeta { name: string; mimeType: string; size: number; createdAt: string; ext: string; path: string; durationSec?: number }
export interface Audio extends AudioMeta { id: string }

export class AudioManager {
  private index = new Map<string, AudioMeta>();
  constructor(private basePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    try {
      for (const f of await readdir(this.basePath)) {
        if (!f.endsWith('.meta.json')) continue;
        const id = basename(f, '.meta.json');
        try { this.index.set(id, JSON.parse(await readFile(join(this.basePath, f), 'utf-8'))); } catch { /* skip */ }
      }
    } catch { /* empty */ }
  }

  async create(params: { name: string; buffer: Buffer; mimeType: string; durationSec?: number }): Promise<Audio> {
    if (!ALLOWED_AUDIO_MIME.has(params.mimeType)) throw new Error(`Invalid audio mime type: ${params.mimeType}`);
    if (params.buffer.length > MAX_AUDIO_SIZE) throw new Error(`Audio exceeds max ${MAX_AUDIO_SIZE} bytes`);
    let baseId = params.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'audio';
    const ext = MIME_EXT[params.mimeType] || 'bin';
    const createdAt = new Date().toISOString();
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? baseId : `${baseId}-${suffix}`;
      const metaPath = join(this.basePath, `${candidate}.meta.json`);
      const binaryPath = join(this.basePath, `${candidate}.${ext}`);
      const meta: AudioMeta = { name: params.name, mimeType: params.mimeType, size: params.buffer.length, createdAt, ext, path: binaryPath, durationSec: params.durationSec };
      try {
        await writeFile(metaPath, JSON.stringify(meta, null, 2), { flag: 'wx' });
        await writeFile(binaryPath, params.buffer);
        this.index.set(candidate, meta);
        return { id: candidate, ...meta };
      } catch (err: any) {
        if (err?.code === 'EEXIST') { suffix++; if (suffix > 1000) throw new Error('Too many id collisions'); continue; }
        throw err;
      }
    }
  }

  async list(): Promise<Array<{ id: string; name: string; mimeType: string; size: number; createdAt: string; durationSec?: number }>> {
    return [...this.index.entries()].map(([id, m]) => ({ id, name: m.name, mimeType: m.mimeType, size: m.size, createdAt: m.createdAt, durationSec: m.durationSec }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Audio | null> {
    const m = this.index.get(id); return m ? { id, ...m } : null;
  }

  async getContent(id: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const m = this.index.get(id); if (!m) return null;
    try { return { buffer: await readFile(m.path), mimeType: m.mimeType }; } catch { return null; }
  }

  async delete(id: string): Promise<void> {
    const m = this.index.get(id); if (!m) throw new Error('Audio not found');
    await unlink(m.path).catch(() => {});
    await unlink(join(this.basePath, `${id}.meta.json`)).catch(() => {});
    this.index.delete(id);
  }
}
