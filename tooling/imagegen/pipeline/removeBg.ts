import sharp from 'sharp';

/**
 * Chroma-key background removal (IMG P3).
 *
 * xAI returns opaque images (no alpha), so transparency is produced HERE. The
 * generator is prompted on a solid chroma color (default green #00b140); this
 * stage keys that color out to alpha=0.
 *
 * Pipeline per pixel:
 *   1. CHROMA KEY: compute a chroma distance from the key color; alpha=0 when
 *      within `tolerance`, else keep opaque. A soft ramp over the tolerance band
 *      yields anti-aliased edges instead of a hard binary cut.
 *   2. DESPILL: pull the key hue back out of edge pixels (the green that bleeds
 *      onto the subject's silhouette) by clamping the key channel toward the
 *      average of the other two.
 *   3. MORPHOLOGICAL CLEANUP: erode then dilate the alpha mask by `edgeShrink`
 *      pixels to kill 1px soft fringes (design risk #2: soft fringes on
 *      billboards), then re-bind alpha.
 */
export interface RemoveBgOptions {
  /** Key color as hex ('00b140' or '#00b140') or [r,g,b]. Default green #00b140. */
  keyColor?: string | [number, number, number];
  /** Chroma distance (0-441) under which a pixel becomes transparent. Default 100. */
  tolerance?: number;
  /** Despill strength 0..1 (how hard to pull the key hue off edges). Default 0.5. */
  despill?: number;
  /** Morphological erode/dilate radius in px to kill soft fringes. Default 1. */
  edgeShrink?: number;
}

function parseKeyColor(c: RemoveBgOptions['keyColor']): [number, number, number] {
  if (Array.isArray(c)) return c;
  const hex = (c ?? '00b140').replace(/^#/, '');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Index of the dominant key channel: 0=r,1=g,2=b. */
function keyChannel(key: [number, number, number]): 0 | 1 | 2 {
  let idx: 0 | 1 | 2 = 0;
  if (key[1] >= key[0] && key[1] >= key[2]) idx = 1;
  else if (key[2] >= key[0] && key[2] >= key[1]) idx = 2;
  return idx;
}

/** In-place box erode (min) or dilate (max) of an alpha plane, radius r, separable. */
function morph(alpha: Uint8Array, w: number, h: number, r: number, mode: 'erode' | 'dilate'): void {
  if (r <= 0) return;
  const pick = mode === 'erode' ? Math.min : Math.max;
  const tmp = new Uint8Array(alpha.length);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = alpha[y * w + x];
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        v = pick(v, alpha[y * w + xx]);
      }
      tmp[y * w + x] = v;
    }
  }
  // vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        v = pick(v, tmp[yy * w + x]);
      }
      alpha[y * w + x] = v;
    }
  }
}

export async function removeBackground(
  input: Buffer | string,
  opts: RemoveBgOptions = {},
): Promise<Buffer> {
  const key = parseKeyColor(opts.keyColor);
  const tolerance = opts.tolerance ?? 100;
  const despill = opts.despill ?? 0.5;
  const edgeShrink = opts.edgeShrink ?? 1;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels } = info;
  const px = new Uint8Array(data); // RGBA
  const alpha = new Uint8Array(w * h);

  const kc = keyChannel(key);
  // Soft ramp band: fully transparent at dist<=tolerance, fully opaque at dist>=tolerance+band.
  const band = Math.max(1, tolerance * 0.5);

  for (let i = 0; i < w * h; i++) {
    const o = i * channels;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const dr = r - key[0], dg = g - key[1], db = b - key[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    let a: number;
    if (dist <= tolerance) a = 0;
    else if (dist >= tolerance + band) a = 255;
    else a = Math.round(((dist - tolerance) / band) * 255);

    alpha[i] = a;

    // Despill: where the key channel exceeds the other two, pull it down toward
    // their average (removes green/blue spill on edges). Only on kept pixels.
    if (a > 0 && despill > 0) {
      const ch = [r, g, b];
      const others = [0, 1, 2].filter((c) => c !== kc);
      const avgOther = (ch[others[0]] + ch[others[1]]) / 2;
      if (ch[kc] > avgOther) {
        ch[kc] = Math.round(ch[kc] - (ch[kc] - avgOther) * despill);
        px[o] = ch[0];
        px[o + 1] = ch[1];
        px[o + 2] = ch[2];
      }
    }
  }

  // Morphological cleanup: erode then dilate (opening) to remove thin fringes.
  if (edgeShrink > 0) {
    morph(alpha, w, h, edgeShrink, 'erode');
    morph(alpha, w, h, edgeShrink, 'dilate');
  }

  // Bind cleaned alpha back into the RGBA buffer.
  for (let i = 0; i < w * h; i++) {
    px[i * channels + 3] = alpha[i];
  }

  return sharp(Buffer.from(px.buffer), { raw: { width: w, height: h, channels: channels as 1 | 2 | 3 | 4 } })
    .png()
    .toBuffer();
}
