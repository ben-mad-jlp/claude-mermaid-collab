import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { removeBackground } from '../pipeline/removeBg.ts';
import { downscale } from '../pipeline/downscale.ts';
import { packSheet } from '../pipeline/packSheet.ts';

/** Build a `size`x`size` image: solid green field with a red square in the center. */
async function greenFieldWithRedSquare(size = 64, sq = 24): Promise<Buffer> {
  const channels = 3;
  const px = new Uint8Array(size * size * channels);
  const lo = Math.floor((size - sq) / 2);
  const hi = lo + sq;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * channels;
      const inSquare = x >= lo && x < hi && y >= lo && y < hi;
      if (inSquare) {
        px[o] = 220; px[o + 1] = 20; px[o + 2] = 20; // red
      } else {
        px[o] = 0; px[o + 1] = 0xb1; px[o + 2] = 0x40; // chroma green #00b140
      }
    }
  }
  return sharp(Buffer.from(px.buffer), { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

async function rawRGBA(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), info };
}

function alphaAt(data: Uint8Array, info: sharp.OutputInfo, x: number, y: number): number {
  const ch = info.channels;
  return data[(y * info.width + x) * ch + 3];
}

describe('removeBackground (chroma key)', () => {
  it('makes the green field transparent and keeps the red square opaque', async () => {
    const src = await greenFieldWithRedSquare(64, 24);
    const out = await removeBackground(src, { keyColor: '00b140', tolerance: 100, edgeShrink: 1 });
    const { data, info } = await rawRGBA(out);

    // Corner is green field -> transparent.
    expect(alphaAt(data, info, 1, 1)).toBe(0);
    expect(alphaAt(data, info, 62, 62)).toBe(0);

    // Center is the red square -> opaque.
    expect(alphaAt(data, info, 32, 32)).toBe(255);
  });

  it('accepts a hex with leading # and an [r,g,b] key color', async () => {
    const src = await greenFieldWithRedSquare(32, 12);
    const a = await removeBackground(src, { keyColor: '#00b140' });
    const b = await removeBackground(src, { keyColor: [0, 0xb1, 0x40] });
    const ra = await rawRGBA(a);
    const rb = await rawRGBA(b);
    expect(alphaAt(ra.data, ra.info, 0, 0)).toBe(0);
    expect(alphaAt(rb.data, rb.info, 0, 0)).toBe(0);
  });
});

describe('downscale (nearest-neighbor)', () => {
  it('resizes to the target height preserving aspect + alpha', async () => {
    // 80x40 transparent-keyed source.
    const src = await greenFieldWithRedSquare(80, 30);
    const keyed = await removeBackground(src, { keyColor: '00b140' });
    // Source is square 80x80 actually; use a non-square to check aspect.
    const rect = await sharp(keyed).resize(80, 40, { fit: 'fill' }).png().toBuffer();

    const out = await downscale(rect, { pixelHeight: 20 });
    const meta = await sharp(out).metadata();
    expect(meta.height).toBe(20);
    expect(meta.width).toBe(40); // 80/40 * 20
    expect(meta.channels).toBe(4); // alpha preserved
    expect(meta.hasAlpha).toBe(true);
  });

  it('quantizes to a palette when requested', async () => {
    const src = await greenFieldWithRedSquare(64, 24);
    const out = await downscale(src, { pixelHeight: 16, palette: 8 });
    const meta = await sharp(out).metadata();
    expect(meta.height).toBe(16);
  });
});

describe('packSheet', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('composes N frames into the right atlas dims + a manifest with N rects', async () => {
    dir = mkdtempSync(join(tmpdir(), 'imagegen-pack-'));
    const frame = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const frames = [frame, frame, frame, frame, frame]; // 5 frames

    const outPath = join(dir, 'anim.sheet.png');
    const { atlasPath, manifestPath, manifest } = await packSheet(frames, { outPath, columns: 3, fps: 10 });

    expect(existsSync(atlasPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(manifestPath).toBe(join(dir, 'anim.sheet.json'));

    // 5 frames, 3 cols => 2 rows. Atlas = 48x32.
    const meta = await sharp(atlasPath).metadata();
    expect(meta.width).toBe(48);
    expect(meta.height).toBe(32);

    expect(manifest.count).toBe(5);
    expect(manifest.columns).toBe(3);
    expect(manifest.rows).toBe(2);
    expect(manifest.fps).toBe(10);
    expect(manifest.frameWidth).toBe(16);
    expect(manifest.frameHeight).toBe(16);
    expect(manifest.frames).toHaveLength(5);
    expect(manifest.padding).toBe(0);
    expect(manifest.atlasWidth).toBe(48);
    expect(manifest.atlasHeight).toBe(32);

    // Frame index 4 sits at row 1, col 1 => x=16, y=16. fps 10 => 100ms/frame.
    expect(manifest.frames[4]).toMatchObject({ index: 4, x: 16, y: 16, w: 16, h: 16, duration: 100, trimmed: false });

    const onDisk = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(onDisk.frames).toHaveLength(5);
  });

  it('inserts padding between/around cells and grows the atlas accordingly', async () => {
    dir = mkdtempSync(join(tmpdir(), 'imagegen-pad-'));
    const frame = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const frames = [frame, frame, frame, frame]; // 2x2 with cols=2

    const outPath = join(dir, 'pad.sheet.png');
    const { manifest } = await packSheet(frames, { outPath, columns: 2, padding: 2 });

    // pitch = 16+2 = 18; atlas = 2 + 2*18 = 38 each side.
    expect(manifest.atlasWidth).toBe(38);
    expect(manifest.atlasHeight).toBe(38);
    expect(manifest.padding).toBe(2);
    // Frame 0 sits at (padding, padding); frame 3 (row1,col1) at (2+18, 2+18) = (20,20).
    expect(manifest.frames[0]).toMatchObject({ x: 2, y: 2 });
    expect(manifest.frames[3]).toMatchObject({ x: 20, y: 20 });

    const meta = await sharp(outPath).metadata();
    expect(meta.width).toBe(38);
    expect(meta.height).toBe(38);
  });

  it('rounds the atlas up to power-of-two dimensions when requested', async () => {
    dir = mkdtempSync(join(tmpdir(), 'imagegen-pow2-'));
    const frame = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const { manifest } = await packSheet([frame, frame, frame], { outPath: join(dir, 'p2.sheet.png'), columns: 3, powerOfTwo: true });
    // raw atlas = 48x16 -> pow2 = 64x16.
    expect(manifest.atlasWidth).toBe(64);
    expect(manifest.atlasHeight).toBe(16);
  });

  it('trims transparent margins and records the tight rect + source offsets', async () => {
    dir = mkdtempSync(join(tmpdir(), 'imagegen-trim-'));
    // 32x32 frame, fully transparent except an 8x8 opaque block at (12,12).
    const block = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const frame = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: block, left: 12, top: 12 }]).png().toBuffer();

    const { manifest } = await packSheet([frame], { outPath: join(dir, 'trim.sheet.png'), columns: 1, trim: true });
    const f = manifest.frames[0];
    expect(f.trimmed).toBe(true);
    expect(f).toMatchObject({ x: 12, y: 12, w: 8, h: 8 });
    expect(f.spriteSourceSize).toEqual({ x: 12, y: 12, w: 8, h: 8 });
    expect(f.sourceSize).toEqual({ w: 32, h: 32 });
  });

  it('emits Aseprite + Phaser + Godot export sidecars with frame tags', async () => {
    dir = mkdtempSync(join(tmpdir(), 'imagegen-exp-'));
    const frame = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const frames = [frame, frame, frame, frame];

    const outPath = join(dir, 'hero.sheet.png');
    const { exports } = await packSheet(frames, {
      outPath, columns: 4, fps: 8,
      animations: [{ name: 'walk', from: 0, to: 3, direction: 'forward', repeat: 0 }],
      exportFormats: ['aseprite', 'phaser', 'godot'],
    });

    // Aseprite: frames hash + frameTags + per-frame durations (1000/8 = 125ms).
    const ase = JSON.parse(exports.aseprite!.content);
    expect(Object.keys(ase.frames)).toHaveLength(4);
    expect(ase.meta.frameTags[0]).toMatchObject({ name: 'walk', from: 0, to: 3 });
    expect(ase.meta.image).toBe('hero.sheet.png');
    expect(Object.values(ase.frames)[0]).toMatchObject({ duration: 125 });
    expect(existsSync(exports.aseprite!.path)).toBe(true);

    // Phaser TexturePacker hash.
    const phaser = JSON.parse(exports.phaser!.content);
    expect(Object.keys(phaser.frames)).toHaveLength(4);
    expect(phaser.meta.image).toBe('hero.sheet.png');

    // Godot .tres references the texture + a named animation.
    const godot = exports.godot!.content;
    expect(godot).toContain('[gd_resource type="SpriteFrames"');
    expect(godot).toContain('path="res://hero.sheet.png"');
    expect(godot).toContain('&"walk"');
    expect(godot).toContain('SubResource("frame_3")');
    expect(existsSync(exports.godot!.path)).toBe(true);
  });

  it('rejects frames of differing size', async () => {
    const a = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const b = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    await expect(packSheet([a, b], { outPath: '/tmp/x.png' })).rejects.toThrow();
  });
});
