import { Jimp, ResizeStrategy } from 'jimp';

/**
 * Nearest-neighbor downscale to a target pixel height (IMG P3).
 *
 * Preserves aspect ratio and alpha. Uses nearest-neighbor so the result keeps crisp
 * pixel-art edges instead of bilinear mush. (Pure-JS jimp — runs inside the compiled
 * bun sidecar, unlike sharp's native module.)
 */
export interface DownscaleOptions {
  /** Target output height in pixels. Width is derived from aspect ratio. */
  pixelHeight: number;
  /** Reserved: indexed-palette quantize. Currently a no-op under jimp (unused by callers). */
  palette?: number;
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
  return img.getBuffer('image/png');
}
