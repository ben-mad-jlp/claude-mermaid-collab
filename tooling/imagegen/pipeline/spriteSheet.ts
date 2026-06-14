import sharp from 'sharp';

/**
 * Sprite-sheet assembly helpers for the grid-orbit pipeline.
 *
 * Flow: an orbit frame at a given angle is a grid (rows×cols) of the character in
 * each animation pose. sliceGrid() cuts it into cells; autocropRecenter() trims each
 * keyed cell to its content and recenters it on a uniform canvas so every frame
 * registers; the caller stacks [angle × pose] and packs with packSheet().
 */

/** Cut an image into rows×cols equal cells (even division). Returns row-major buffers. */
export async function sliceGrid(input: Buffer | string, rows: number, cols: number): Promise<Buffer[]> {
  const img = sharp(input);
  const meta = await img.metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error('sliceGrid: input has no dimensions');
  const cw = Math.floor(W / cols), chh = Math.floor(H / rows);
  const cells: Buffer[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        await sharp(input)
          .extract({ left: c * cw, top: r * chh, width: cw, height: chh })
          .png()
          .toBuffer(),
      );
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
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + 3] >= alphaThreshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const canvas = sharp({ create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (maxX < 0) return canvas.png().toBuffer(); // empty

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  // scale down to fit if the content is larger than the target cell (preserve aspect)
  const scale = Math.min(1, outW / bw, outH / bh);
  const tw = Math.max(1, Math.round(bw * scale)), th = Math.max(1, Math.round(bh * scale));
  let content = sharp(input).extract({ left: minX, top: minY, width: bw, height: bh });
  if (scale < 1) content = content.resize(tw, th, { kernel: 'nearest' });
  const contentBuf = await content.png().toBuffer();
  const left = Math.round((outW - tw) / 2), top = Math.round((outH - th) / 2);
  return canvas.composite([{ input: contentBuf, left, top }]).png().toBuffer();
}
