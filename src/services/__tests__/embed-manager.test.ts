import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbedManager } from '../embed-manager';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EmbedManager', () => {
  let manager: EmbedManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'embed-test-'));
    manager = new EmbedManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create an embed and return full Embed object', async () => {
      const embed = await manager.create({
        name: 'Test Embed',
        url: 'http://localhost:6006/iframe.html',
      });
      expect(embed.id).toBe('test-embed');
      expect(embed.name).toBe('Test Embed');
      expect(embed.url).toBe('http://localhost:6006/iframe.html');
      expect(embed.createdAt).toBeDefined();
    });

    it('should reject URLs without http/https', async () => {
      await expect(
        manager.create({ name: 'Bad', url: 'ftp://example.com' })
      ).rejects.toThrow('URL must start with http://');
    });

    it('should deduplicate IDs with suffix', async () => {
      const first = await manager.create({ name: 'Dup', url: 'http://a.com' });
      const second = await manager.create({ name: 'Dup', url: 'http://b.com' });
      expect(first.id).toBe('dup');
      expect(second.id).toBe('dup-1');
    });

    it('should persist storybook metadata', async () => {
      const embed = await manager.create({
        name: 'SB',
        url: 'http://localhost:6006/iframe.html?id=test',
        subtype: 'storybook',
        storybook: { storyId: 'test', port: 6006 },
      });
      expect(embed.subtype).toBe('storybook');
      expect(embed.storybook).toEqual({ storyId: 'test', port: 6006 });
    });
  });

  describe('list', () => {
    it('should return all embeds', async () => {
      await manager.create({ name: 'A', url: 'http://a.com' });
      await manager.create({ name: 'B', url: 'http://b.com' });
      const embeds = await manager.list();
      expect(embeds).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should retrieve embed by ID', async () => {
      await manager.create({ name: 'Find Me', url: 'http://find.com' });
      const embed = await manager.get('find-me');
      expect(embed).not.toBeNull();
      expect(embed!.name).toBe('Find Me');
    });

    it('should return null for unknown ID', async () => {
      const embed = await manager.get('nonexistent');
      expect(embed).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove embed', async () => {
      await manager.create({ name: 'Delete Me', url: 'http://del.com' });
      await manager.delete('delete-me');
      expect(manager.hasEmbed('delete-me')).toBe(false);
    });

    it('should throw for unknown ID', async () => {
      await expect(manager.delete('nope')).rejects.toThrow('Embed not found');
    });
  });

  describe('initialize', () => {
    it('should reload index from disk', async () => {
      await manager.create({ name: 'Persist', url: 'http://p.com' });
      const manager2 = new EmbedManager(tempDir);
      await manager2.initialize();
      expect(manager2.hasEmbed('persist')).toBe(true);
      expect(manager2.getIndexSize()).toBe(1);
    });
  });
});
