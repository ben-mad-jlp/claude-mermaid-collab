import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { Image, ImageMeta, ImageListItem } from '../types';
import { config } from '../config';

export class ImageManager {
  private index: Map<string, ImageMeta> = new Map();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    try {
      const files = await readdir(this.basePath);
      for (const file of files) {
        if (!file.endsWith('.meta.json')) continue;
        const id = basename(file, '.meta.json');
        const filePath = join(this.basePath, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          const meta: ImageMeta = JSON.parse(content);
          this.index.set(id, meta);
        } catch {
          // Skip corrupted metadata files
        }
      }
    } catch {
      // Directory doesn't exist yet, empty index is fine
    }
  }

  async create(params: {
    name: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<Image> {
    if (!(config.ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(params.mimeType)) {
      throw new Error(`Invalid mime type: ${params.mimeType}`);
    }

    if (params.buffer.length > config.MAX_IMAGE_SIZE) {
      throw new Error(`Image size exceeds maximum of ${config.MAX_IMAGE_SIZE} bytes`);
    }

    // Sanitize base id
    let baseId = params.name
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    if (!baseId) baseId = 'image';

    const ext = this.mimeTypeToExt(params.mimeType);
    const uploadedAt = new Date().toISOString();
    const imageMetaBase = {
      name: params.name,
      mimeType: params.mimeType,
      size: params.buffer.length,
      uploadedAt,
      ext,
    };

    let id = baseId;
    let suffix = 0;
    let metaPath: string;
    let binaryPath: string;

    while (true) {
      const candidate = suffix === 0 ? baseId : `${baseId}-${suffix}`;
      metaPath = join(this.basePath, `${candidate}.meta.json`);
      binaryPath = join(this.basePath, `${candidate}.${ext}`);
      const meta: ImageMeta = { ...imageMetaBase, path: binaryPath };
      try {
        // Exclusive create — fails with EEXIST if the meta already exists
        await writeFile(metaPath, JSON.stringify(meta, null, 2), { flag: 'wx' });
        id = candidate;
        this.index.set(id, meta);
        break;
      } catch (err: any) {
        if (err && err.code === 'EEXIST') {
          suffix++;
          if (suffix > 1000) throw new Error('Too many id collisions');
          continue;
        }
        throw err;
      }
    }

    // Write binary last — if this fails we leave a sidecar, tolerable since initialize() will
    // retain it in the index and a subsequent getContent() returns null (matching missing-binary semantics).
    await writeFile(binaryPath, params.buffer);

    return {
      id,
      name: params.name,
      mimeType: params.mimeType,
      size: params.buffer.length,
      uploadedAt,
      ext,
    };
  }

  async list(): Promise<ImageListItem[]> {
    const items: ImageListItem[] = [];
    for (const [id, meta] of this.index) {
      items.push({
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        uploadedAt: meta.uploadedAt,
      });
    }
    return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string): Promise<Image | null> {
    const meta = this.index.get(id);
    if (!meta) return null;
    return {
      id,
      name: meta.name,
      mimeType: meta.mimeType,
      size: meta.size,
      uploadedAt: meta.uploadedAt,
      ext: meta.ext,
    };
  }

  async getContent(id: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const meta = this.index.get(id);
    if (!meta) return null;
    try {
      const buffer = await readFile(meta.path);
      return { buffer, mimeType: meta.mimeType };
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error('Image not found');
    try {
      await unlink(meta.path);
    } catch {
      // Tolerate missing binary
    }
    try {
      const metaPath = join(this.basePath, `${id}.meta.json`);
      await unlink(metaPath);
    } catch {
      // Tolerate missing sidecar
    }
    this.index.delete(id);
  }

  hasImage(id: string): boolean {
    return this.index.has(id);
  }

  getIndexSize(): number {
    return this.index.size;
  }

  reset(): void {
    this.index.clear();
  }

  private mimeTypeToExt(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    };
    return mimeToExt[mimeType] || 'bin';
  }
}
