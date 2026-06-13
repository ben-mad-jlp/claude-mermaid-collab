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

    // Frame index 4 sits at row 1, col 1 => x=16, y=16.
    expect(manifest.frames[4]).toEqual({ index: 4, x: 16, y: 16, w: 16, h: 16 });

    const onDisk = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(onDisk.frames).toHaveLength(5);
  });

  it('rejects frames of differing size', async () => {
    const a = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const b = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    await expect(packSheet([a, b], { outPath: '/tmp/x.png' })).rejects.toThrow();
  });
});
