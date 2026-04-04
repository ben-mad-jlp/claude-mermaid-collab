import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { Embed, EmbedMeta } from '../types';

export class EmbedManager {
  private index: Map<string, EmbedMeta> = new Map();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    try {
      const files = await readdir(this.basePath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = basename(file, '.json');
        const filePath = join(this.basePath, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          const embed: Embed = JSON.parse(content);
          this.index.set(id, { name: embed.name, path: filePath, createdAt: embed.createdAt });
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory doesn't exist yet, empty index is fine
    }
  }

  async create(params: {
    name: string;
    url: string;
    subtype?: 'storybook';
    width?: string;
    height?: string;
    storybook?: { storyId: string; port: number };
  }): Promise<Embed> {
    if (!params.url.startsWith('http://') && !params.url.startsWith('https://')) {
      throw new Error('URL must start with http:// or https://');
    }

    let id = params.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    if (this.index.has(id)) {
      let suffix = 1;
      while (this.index.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }

    const embed: Embed = {
      id,
      name: params.name,
      url: params.url,
      subtype: params.subtype,
      width: params.width,
      height: params.height,
      createdAt: new Date().toISOString(),
      storybook: params.storybook,
    };

    const filePath = join(this.basePath, `${id}.json`);
    await writeFile(filePath, JSON.stringify(embed, null, 2));
    this.index.set(id, { name: params.name, path: filePath, createdAt: embed.createdAt });

    return embed;
  }

  async list(): Promise<Embed[]> {
    const embeds: Embed[] = [];
    for (const [id] of this.index) {
      const embed = await this.get(id);
      if (embed) embeds.push(embed);
    }
    return embeds.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Embed | null> {
    const meta = this.index.get(id);
    if (!meta) return null;
    try {
      const content = await readFile(meta.path, 'utf-8');
      return JSON.parse(content) as Embed;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error('Embed not found');
    await unlink(meta.path);
    this.index.delete(id);
  }

  hasEmbed(id: string): boolean {
    return this.index.has(id);
  }

  getIndexSize(): number {
    return this.index.size;
  }

  reset(): void {
    this.index.clear();
  }
}
