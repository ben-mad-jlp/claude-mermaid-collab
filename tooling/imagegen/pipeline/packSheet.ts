import { Jimp } from 'jimp';
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

  // Decode + validate uniform frame size.
  const imgs = await Promise.all(frames.map((f) => Jimp.read(f as Buffer)));
  const frameWidth = imgs[0].bitmap.width;
  const frameHeight = imgs[0].bitmap.height;
  if (!frameWidth || !frameHeight) throw new Error('packSheet: first frame has no dimensions');
  for (let i = 1; i < imgs.length; i++) {
    if (imgs[i].bitmap.width !== frameWidth || imgs[i].bitmap.height !== frameHeight) {
      throw new Error(
        `packSheet: frame ${i} is ${imgs[i].bitmap.width}x${imgs[i].bitmap.height}, expected ${frameWidth}x${frameHeight}`,
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
  const atlasImg = new Jimp({ width: atlasW, height: atlasH, color: 0x00000000 });
  for (let i = 0; i < imgs.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * frameWidth;
    const y = row * frameHeight;
    frameRects.push({ index: i, x, y, w: frameWidth, h: frameHeight });
    atlasImg.composite(imgs[i], x, y);
  }
  const atlas = await atlasImg.getBuffer('image/png');

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
