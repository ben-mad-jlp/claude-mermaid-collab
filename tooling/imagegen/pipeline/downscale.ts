import sharp from 'sharp';

/**
 * Nearest-neighbor downscale to a target pixel height (IMG P3).
 *
 * Preserves aspect ratio and alpha. Uses sharp's 'nearest' kernel so the result
 * keeps crisp pixel-art edges instead of bilinear mush. Optional palette quantize
 * for a retro indexed-color look.
 */
export interface DownscaleOptions {
  /** Target output height in pixels. Width is derived from aspect ratio. */
  pixelHeight: number;
  /** If set, quantize to this many colors (indexed PNG) for a retro palette. */
  palette?: number;
}

export async function downscale(
  input: Buffer | string,
  opts: DownscaleOptions,
): Promise<Buffer> {
  const img = sharp(input).ensureAlpha();
  const meta = await img.metadata();
  const srcW = meta.width ?? opts.pixelHeight;
  const srcH = meta.height ?? opts.pixelHeight;

  const targetH = opts.pixelHeight;
  const targetW = Math.max(1, Math.round((srcW / srcH) * targetH));

  let pipe = sharp(input)
    .ensureAlpha()
    .resize(targetW, targetH, { kernel: 'nearest', fit: 'fill' });

  if (opts.palette && opts.palette > 0) {
    pipe = pipe.png({ palette: true, colors: opts.palette });
  } else {
    pipe = pipe.png();
  }

  return pipe.toBuffer();
}
