import { Jimp, ResizeStrategy } from 'jimp';

/**
 * Sprite-sheet assembly helpers for the grid-orbit pipeline.
 *
 * Flow: an orbit frame at a given angle is a grid (rows×cols) of the character in
 * each animation pose. sliceGrid() cuts it into cells; autocropRecenter() trims each
 * keyed cell to its content and recenters it on a uniform canvas so every frame
 * registers; the caller stacks [angle × pose] and packs with packSheet().
 */

/** Distinct, saturated marker colors (with model-friendly names) for the pivot pedestal. */
export const MARKER_CANDIDATES: Array<{ name: string; hex: string; rgb: [number, number, number] }> = [
  { name: 'cyan', hex: '#00ecf8', rgb: [0, 236, 248] },
  { name: 'magenta', hex: '#ff10e0', rgb: [255, 16, 224] },
  { name: 'orange', hex: '#ff7a00', rgb: [255, 122, 0] },
  { name: 'blue', hex: '#1030ff', rgb: [16, 48, 255] },
  { name: 'yellow', hex: '#ffe000', rgb: [255, 224, 0] },
  { name: 'red', hex: '#ff1020', rgb: [255, 16, 32] },
  { name: 'purple', hex: '#9000ff', rgb: [144, 0, 255] },
];

/**
 * Pick the marker/pedestal color most ABSENT from a character image, so it keys out
 * cleanly without eating the character. Samples non-background pixels and chooses the
 * candidate whose nearest character color (and the chroma bg) is farthest.
 */
export async function pickMarkerColor(
  input: Buffer | string,
  bgKeyRgb: [number, number, number] = [0, 177, 64],
): Promise<{ name: string; hex: string }> {
  const sample = await Jimp.read(input as Buffer);
  sample.resize({ w: 64, h: Math.max(1, Math.round(64 * sample.bitmap.height / sample.bitmap.width)), mode: ResizeStrategy.BILINEAR });
  const data = sample.bitmap.data; const w = sample.bitmap.width, h = sample.bitmap.height, ch = 4;
  const charColors: [number, number, number][] = [];
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const r = data[o], g = data[o + 1], b = data[o + 2], a = ch === 4 ? data[o + 3] : 255;
    if (a < 32) continue; // transparent
    const dbg = Math.abs(r - bgKeyRgb[0]) + Math.abs(g - bgKeyRgb[1]) + Math.abs(b - bgKeyRgb[2]);
    if (dbg < 80) continue; // background pixel
    charColors.push([r, g, b]);
  }
  let best = MARKER_CANDIDATES[0], bestScore = -1;
  for (const c of MARKER_CANDIDATES) {
    let minD = Infinity;
    for (const cc of charColors) {
      const d = Math.hypot(c.rgb[0] - cc[0], c.rgb[1] - cc[1], c.rgb[2] - cc[2]);
      if (d < minD) minD = d;
    }
    const dbgc = Math.hypot(c.rgb[0] - bgKeyRgb[0], c.rgb[1] - bgKeyRgb[1], c.rgb[2] - bgKeyRgb[2]);
    const score = Math.min(minD === Infinity ? 999 : minD, dbgc);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return { name: best.name, hex: best.hex };
}

/** Cut an image into rows×cols equal cells (even division). Returns row-major buffers. */
export async function sliceGrid(input: Buffer | string, rows: number, cols: number): Promise<Buffer[]> {
  const img = await Jimp.read(input as Buffer);
  const W = img.bitmap.width, H = img.bitmap.height;
  if (!W || !H) throw new Error('sliceGrid: input has no dimensions');
  const cw = Math.floor(W / cols), chh = Math.floor(H / rows);
  const cells: Buffer[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = img.clone().crop({ x: c * cw, y: r * chh, w: cw, h: chh });
      cells.push(await cell.getBuffer('image/png'));
    }
  }
  return cells;
}

/**
 * Trim a keyed (transparent-background) cell to its opaque content bbox, then center
 * it on a fresh `outW`×`outH` transparent canvas. `alphaThreshold` is the min alpha
 * counted as content. Returns a uniform-size sprite; if the cell is fully transparent
 * it returns a blank canvas.
 */
export async function autocropRecenter(
  input: Buffer,
  outW: number,
  outH: number,
  alphaThreshold = 16,
): Promise<Buffer> {
  const img = await Jimp.read(input as Buffer);
  const w = img.bitmap.width, h = img.bitmap.height, ch = 4;
  const data = img.bitmap.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + 3] >= alphaThreshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const canvas = new Jimp({ width: outW, height: outH, color: 0x00000000 });
  if (maxX < 0) return canvas.getBuffer('image/png'); // empty

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  // scale down to fit if the content is larger than the target cell (preserve aspect)
  const scale = Math.min(1, outW / bw, outH / bh);
  const tw = Math.max(1, Math.round(bw * scale)), th = Math.max(1, Math.round(bh * scale));
  const content = img.clone().crop({ x: minX, y: minY, w: bw, h: bh });
  if (scale < 1) content.resize({ w: tw, h: th, mode: ResizeStrategy.NEAREST_NEIGHBOR });
  const left = Math.round((outW - tw) / 2), top = Math.round((outH - th) / 2);
  canvas.composite(content, left, top);
  return canvas.getBuffer('image/png');
}
