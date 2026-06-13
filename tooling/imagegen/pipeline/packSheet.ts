import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

/**
 * Pack N equal-size frames into a grid sprite-sheet atlas + JSON manifest (IMG P3).
 *
 * The manifest is shaped for a three.js consumer (figure-h8 `Billboard.setFrames`
 * slices a sheet by frame rects): each frame carries its pixel rect {x,y,w,h}.
 */
export interface FrameRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheetManifest {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  count: number;
  fps: number;
  frames: FrameRect[];
}

export interface PackSheetOptions {
  /** Number of columns in the grid. Default: ceil(sqrt(n)). */
  columns?: number;
  /** Animation frame rate, recorded in the manifest. Default 12. */
  fps?: number;
  /** Output atlas PNG path. The manifest is written next to it as `<base>.json`. */
  outPath: string;
}

export async function packSheet(
  frames: Buffer[],
  opts: PackSheetOptions,
): Promise<{ atlasPath: string; manifestPath: string; manifest: SpriteSheetManifest }> {
  if (frames.length === 0) throw new Error('packSheet: no frames provided');

  // Validate uniform frame size.
  const metas = await Promise.all(frames.map((f) => sharp(f).metadata()));
  const frameWidth = metas[0].width ?? 0;
  const frameHeight = metas[0].height ?? 0;
  if (!frameWidth || !frameHeight) throw new Error('packSheet: first frame has no dimensions');
  for (let i = 1; i < metas.length; i++) {
    if (metas[i].width !== frameWidth || metas[i].height !== frameHeight) {
      throw new Error(
        `packSheet: frame ${i} is ${metas[i].width}x${metas[i].height}, expected ${frameWidth}x${frameHeight}`,
      );
    }
  }

  const count = frames.length;
  const columns = opts.columns && opts.columns > 0 ? opts.columns : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const fps = opts.fps ?? 12;

  const atlasW = columns * frameWidth;
  const atlasH = rows * frameHeight;

  const frameRects: FrameRect[] = [];
  const composites = await Promise.all(
    frames.map(async (f, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * frameWidth;
      const y = row * frameHeight;
      frameRects.push({ index: i, x, y, w: frameWidth, h: frameHeight });
      // Ensure PNG/RGBA input for compositing.
      const buf = await sharp(f).ensureAlpha().png().toBuffer();
      return { input: buf, left: x, top: y };
    }),
  );

  const atlas = await sharp({
    create: {
      width: atlasW,
      height: atlasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const atlasPath = opts.outPath;
  const manifestPath = atlasPath.replace(/\.[^.]+$/, '') + '.json';

  const manifest: SpriteSheetManifest = {
    frameWidth,
    frameHeight,
    columns,
    rows,
    count,
    fps,
    frames: frameRects.sort((a, b) => a.index - b.index),
  };

  writeFileSync(atlasPath, atlas);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { atlasPath, manifestPath, manifest };
}
