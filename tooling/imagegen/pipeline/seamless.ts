import { Jimp } from 'jimp';

/**
 * Make a texture tile seamlessly by the offset-and-heal method: roll the image by half
 * (so the formerly-wrapping edges meet in the centre as a cross seam), then feather-blend
 * a band across that seam so it disappears. Tiling the result edge-to-edge is seamless.
 *
 * `axis` 'both' (tilesets), 'x' (horizontally-scrolling backgrounds), or 'y'.
 * `band` is the half-width (px) of the feather region. Pure jimp — runs in the sidecar.
 */
export async function makeSeamless(
  input: Buffer | string,
  opts: { axis?: 'both' | 'x' | 'y'; band?: number } = {},
): Promise<Buffer> {
  const axis = opts.axis ?? 'both';
  const img = await Jimp.read(input as Buffer);
  const W = img.bitmap.width, H = img.bitmap.height;
  const src = Buffer.from(img.bitmap.data); // copy of original RGBA
  const dst = img.bitmap.data;
  const ox = axis === 'y' ? 0 : (W >> 1);
  const oy = axis === 'x' ? 0 : (H >> 1);
  // roll by (ox,oy) with wrap
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (x + ox) % W, sy = (y + oy) % H;
      const di = (y * W + x) * 4, si = (sy * W + sx) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  // feather-heal the seam(s): blend each seam pixel toward the average of its mirror across the seam
  const band = Math.max(2, opts.band ?? Math.round(Math.min(W, H) * 0.08));
  const blendCol = (cx: number) => {
    for (let d = 1; d <= band; d++) {
      const wgt = 1 - d / (band + 1);
      for (const x of [cx - d, cx + d]) {
        if (x < 0 || x >= W) continue;
        const mx = (2 * cx - x + W) % W; // mirror across seam
        for (let y = 0; y < H; y++) {
          const i = (y * W + x) * 4, m = (y * W + mx) * 4;
          for (let c = 0; c < 3; c++) dst[i + c] = Math.round(dst[i + c] * (1 - wgt * 0.5) + dst[m + c] * (wgt * 0.5));
        }
      }
    }
  };
  const blendRow = (cy: number) => {
    for (let d = 1; d <= band; d++) {
      const wgt = 1 - d / (band + 1);
      for (const y of [cy - d, cy + d]) {
        if (y < 0 || y >= H) continue;
        const my = (2 * cy - y + H) % H;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, m = (my * W + x) * 4;
          for (let c = 0; c < 3; c++) dst[i + c] = Math.round(dst[i + c] * (1 - wgt * 0.5) + dst[m + c] * (wgt * 0.5));
        }
      }
    }
  };
  if (axis !== 'y') blendCol(W >> 1);
  if (axis !== 'x') blendRow(H >> 1);
  return img.getBuffer('image/png');
}
