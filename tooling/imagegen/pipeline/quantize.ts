import { Jimp } from 'jimp';

/**
 * Palette quantization (pure-JS, jimp bitmap scan — runs inside the compiled bun
 * sidecar, unlike sharp's native module).
 *
 * Two modes, both DETERMINISTIC so the same input always yields the same colors:
 *   - FIXED palette: a list of hex colors. Every opaque pixel snaps to its nearest
 *     palette entry (Euclidean RGB). This is what makes separately-generated assets
 *     share one cohesive look — feed them the same project palette.
 *   - N-color: a target color count. A median-cut palette is derived from the image's
 *     own opaque pixels, then every pixel snaps to it.
 *
 * Fully transparent pixels (alpha 0) are left untouched so chroma-keyed sprite edges
 * stay clean.
 */

export type RGB = [number, number, number];

/** Parse a hex color ('#00b140' | '00b140' | '#fff') into an [r,g,b] triple. */
export function parseHexColor(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Index of the nearest palette color to (r,g,b) by squared Euclidean distance. */
function nearestIndex(palette: RGB[], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Derive an N-color palette from a set of opaque pixels via median-cut.
 * Deterministic: boxes are split along their longest channel at the median index,
 * and ties are broken by a stable sort, so the same pixels always produce the same
 * palette.
 */
export function medianCutPalette(pixels: RGB[], n: number): RGB[] {
  const target = Math.max(1, Math.floor(n));
  if (pixels.length === 0) return [[0, 0, 0]];

  // De-dup identical colors up front so a flat image collapses to its real colors.
  const uniq = new Map<number, RGB>();
  for (const p of pixels) uniq.set((p[0] << 16) | (p[1] << 8) | p[2], p);
  let boxes: RGB[][] = [[...uniq.values()]];
  if (boxes[0].length <= target) {
    return boxes[0].slice().sort(cmpRGB);
  }

  while (boxes.length < target) {
    // Pick the box with the largest single-channel range to split next.
    let bestBox = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const [range, channel] = widestChannel(boxes[i]);
      if (range > bestRange) {
        bestRange = range;
        bestBox = i;
        bestChannel = channel;
      }
    }
    if (bestBox < 0) break; // nothing left splittable

    const box = boxes[bestBox];
    box.sort((a, b) => a[bestChannel] - b[bestChannel] || cmpRGB(a, b));
    const mid = box.length >> 1;
    const lo = box.slice(0, mid);
    const hi = box.slice(mid);
    boxes.splice(bestBox, 1, lo, hi);
  }

  return boxes.map(averageColor).sort(cmpRGB);
}

function widestChannel(box: RGB[]): [number, number] {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const p of box) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  let channel = 0;
  let range = -1;
  for (let c = 0; c < 3; c++) {
    const r = max[c] - min[c];
    if (r > range) {
      range = r;
      channel = c;
    }
  }
  return [range, channel];
}

function averageColor(box: RGB[]): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of box) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = box.length || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function cmpRGB(a: RGB, b: RGB): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Resolve a `palette` spec against an image's bitmap into a concrete list of colors:
 *   - string[] of hex  → parsed fixed palette (FIXED mode)
 *   - number           → median-cut palette derived from the opaque pixels (N-color mode)
 */
export function resolvePalette(palette: number | string[], data: Buffer, w: number, h: number): RGB[] {
  if (Array.isArray(palette)) {
    if (palette.length === 0) throw new Error('palette[] must contain at least one color');
    return palette.map(parseHexColor);
  }
  const pixels: RGB[] = [];
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue; // skip fully transparent
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  return medianCutPalette(pixels, palette);
}

/** Snap every opaque pixel of `input` to its nearest color in `palette`, in place on a copy. */
export async function quantizeToPalette(input: Buffer, palette: RGB[]): Promise<Buffer> {
  if (palette.length === 0) throw new Error('palette must contain at least one color');
  const img = await Jimp.read(input as Buffer);
  const { data, width: w, height: h } = img.bitmap;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue; // leave transparent pixels untouched
    const idx = nearestIndex(palette, data[o], data[o + 1], data[o + 2]);
    data[o] = palette[idx][0];
    data[o + 1] = palette[idx][1];
    data[o + 2] = palette[idx][2];
  }
  return img.getBuffer('image/png');
}

/**
 * Quantize a PNG buffer by a palette spec (fixed hex list or N-color median-cut).
 * Convenience wrapper used by callers that don't already hold the raw bitmap.
 */
export async function quantizeBuffer(input: Buffer, palette: number | string[]): Promise<Buffer> {
  const img = await Jimp.read(input as Buffer);
  const resolved = resolvePalette(palette, img.bitmap.data, img.bitmap.width, img.bitmap.height);
  return quantizeToPalette(input, resolved);
}
