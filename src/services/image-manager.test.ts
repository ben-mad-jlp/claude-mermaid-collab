import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ImageManager } from './image-manager';

// Minimal 1x1 red PNG (67 bytes)
const PNG_1x1_RED = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb6, 0xee, 0x56, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('ImageManager', () => {
  let dir: string;
  let mgr: ImageManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'image-manager-test-'));
    mgr = new ImageManager(dir);
    await mgr.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates an image and round-trips it', async () => {
    const image = await mgr.create({
      name: 'test.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    expect(image.id).toBe('test-png');
    expect(image.name).toBe('test.png');
    expect(image.mimeType).toBe('image/png');
    expect(image.size).toBe(PNG_1x1_RED.length);
    expect(image.ext).toBe('png');
    expect(image.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lists created images sorted by uploadedAt descending', async () => {
    const first = await mgr.create({
      name: 'first.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await mgr.create({
      name: 'second.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    const list = await mgr.list();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
  });

  it('get returns metadata for existing image and null for missing', async () => {
    const image = await mgr.create({
      name: 'x.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    const fetched = await mgr.get(image.id);
    expect(fetched?.id).toBe(image.id);
    expect(fetched?.mimeType).toBe('image/png');
    expect(await mgr.get('no-such-id')).toBeNull();
  });

  it('getContent returns the original bytes', async () => {
    const image = await mgr.create({
      name: 'bytes.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    const content = await mgr.getContent(image.id);
    expect(content).not.toBeNull();
    expect(content!.mimeType).toBe('image/png');
    expect(Buffer.compare(content!.buffer, PNG_1x1_RED)).toBe(0);
  });

  it('delete removes the image and its content', async () => {
    const image = await mgr.create({
      name: 'gone.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    await mgr.delete(image.id);
    expect(await mgr.get(image.id)).toBeNull();
    expect(await mgr.getContent(image.id)).toBeNull();
    expect(mgr.hasImage(image.id)).toBe(false);
  });

  it('rejects unsupported mime types', async () => {
    await expect(
      mgr.create({
        name: 'bad.bin',
        buffer: PNG_1x1_RED,
        mimeType: 'application/octet-stream',
      })
    ).rejects.toThrow(/mime/i);
  });

  it('rejects oversized images', async () => {
    const huge = Buffer.alloc(60 * 1024 * 1024); // 60 MB — above the 50 MB limit
    await expect(
      mgr.create({ name: 'huge.png', buffer: huge, mimeType: 'image/png' })
    ).rejects.toThrow(/exceeds|too large/i);
  });

  it('generates unique ids on name collision', async () => {
    const a = await mgr.create({
      name: 'dup.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    const b = await mgr.create({
      name: 'dup.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    expect(a.id).not.toBe(b.id);
    expect(b.id).toMatch(/^dup-png-\d+$/);
  });

  it('reinitializes from disk state', async () => {
    const image = await mgr.create({
      name: 'persist.png',
      buffer: PNG_1x1_RED,
      mimeType: 'image/png',
    });
    const mgr2 = new ImageManager(dir);
    await mgr2.initialize();
    const fetched = await mgr2.get(image.id);
    expect(fetched?.id).toBe(image.id);
    expect(fetched?.mimeType).toBe('image/png');
    const list = await mgr2.list();
    expect(list.length).toBe(1);
  });
});
