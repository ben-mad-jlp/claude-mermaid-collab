import { Jimp, ResizeStrategy } from 'jimp';
import { resolvePalette, quantizeToPalette } from './quantize.ts';

/**
 * Nearest-neighbor downscale to a target pixel height (IMG P3).
 *
 * Preserves aspect ratio and alpha. Uses nearest-neighbor so the result keeps crisp
 * pixel-art edges instead of bilinear mush. (Pure-JS jimp — runs inside the compiled
 * bun sidecar, unlike sharp's native module.)
 *
 * Optional palette quantize (see ./quantize.ts) snaps the result onto a fixed project
 * palette or to N median-cut colors — the cohesive-retro-look step. Quantization runs
 * AFTER the resize so it operates on the final small pixel grid.
 */
export interface DownscaleOptions {
  /** Target output height in pixels. Width is derived from aspect ratio. */
  pixelHeight: number;
  /**
   * Palette quantize:
   *   - string[] of hex → snap to that FIXED palette (cohesive cross-asset look)
   *   - number          → snap to N median-cut colors derived from the image
   * Omitted/empty → no quantize (raw colors kept).
   */
  palette?: number | string[];
}

export async function downscale(
  input: Buffer | string,
  opts: DownscaleOptions,
): Promise<Buffer> {
  const img = await Jimp.read(input as Buffer);
  const srcW = img.bitmap.width || opts.pixelHeight;
  const srcH = img.bitmap.height || opts.pixelHeight;

  const targetH = opts.pixelHeight;
  const targetW = Math.max(1, Math.round((srcW / srcH) * targetH));

  img.resize({ w: targetW, h: targetH, mode: ResizeStrategy.NEAREST_NEIGHBOR });
  const resized = await img.getBuffer('image/png');

  if (opts.palette === undefined || (Array.isArray(opts.palette) && opts.palette.length === 0)) {
    return resized;
  }
  const resolved = resolvePalette(opts.palette, img.bitmap.data, img.bitmap.width, img.bitmap.height);
  return quantizeToPalette(resized, resolved);
}
