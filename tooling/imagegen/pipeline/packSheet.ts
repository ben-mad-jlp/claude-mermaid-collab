import { Jimp } from 'jimp';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  type AnimationTag,
  type ExportFormat,
  type ExportFrame,
  type ExportManifest,
  buildExport,
} from './exporters';

export type { AnimationTag, ExportFormat } from './exporters';

/**
 * Pack N equal-size frames into a grid sprite-sheet atlas + JSON manifest (IMG P3).
 *
 * The base manifest is shaped for a three.js consumer (figure-h8 `Billboard.setFrames`
 * slices a sheet by frame rects): each frame carries its pixel rect {x,y,w,h}.
 *
 * T1 — engine-ready export: optional inter-cell PADDING (texture-bleed guard),
 * power-of-two atlas, per-frame TRIM, named ANIMATION TAGS + per-frame durations,
 * and `exportFormats` sidecars (Aseprite / Phaser / Godot) written next to the atlas.
 */
export interface FrameRect {
  index: number;
  /** Position + size of the (possibly trimmed) frame inside the atlas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-frame display duration in ms (derived from fps; 0 when fps is 0). */
  duration: number;
  /** True when transparent margins were trimmed off this frame. */
  trimmed: boolean;
  /** Offset + tight size of the trimmed sprite within the original cell. */
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  /** Original (untrimmed) cell size. */
  sourceSize: { w: number; h: number };
}

export interface SpriteSheetManifest {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  count: number;
  fps: number;
  /** Pixel gap between (and around) cells. Default 0. */
  padding: number;
  /** Full atlas dimensions (account for padding + power-of-two rounding). */
  atlasWidth: number;
  atlasHeight: number;
  /** Atlas image filename the manifest/exports reference. */
  image: string;
  /** Named animation tags (frame ranges + direction/loop). */
  animations: AnimationTag[];
  frames: FrameRect[];
}

export interface PackSheetOptions {
  /** Number of columns in the grid. Default: ceil(sqrt(n)). */
  columns?: number;
  /** Animation frame rate, recorded in the manifest + used to derive per-frame durations. Default 12. */
  fps?: number;
  /** Output atlas PNG path. The manifest is written next to it as `<base>.json`. */
  outPath: string;
  /** Pixel gap between and around cells (prevents texture bleed when filtering). Default 0. */
  padding?: number;
  /** Round the atlas up to power-of-two dimensions (some GPUs/engines prefer it). Default false. */
  powerOfTwo?: boolean;
  /** Trim transparent margins per frame; records the tight rect + source offsets. Default false. */
  trim?: boolean;
  /** Named animation tags. Frame indices are clamped to [0, count-1]. */
  animations?: AnimationTag[];
  /** Engine export sidecars to also write next to the atlas (Aseprite/Phaser/Godot). */
  exportFormats?: ExportFormat[];
}

export interface PackSheetResult {
  atlasPath: string;
  manifestPath: string;
  manifest: SpriteSheetManifest;
  /** Engine export sidecars keyed by format, each with its written path + content. */
  exports: Partial<Record<ExportFormat, { path: string; content: string }>>;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Tight bounding box of non-transparent pixels, or null if the frame is fully transparent. */
function alphaBounds(bitmap: { data: Uint8Array | Buffer; width: number; height: number }): { left: number; top: number; w: number; h: number } | null {
  const { data, width, height } = bitmap;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export async function packSheet(frames: Buffer[], opts: PackSheetOptions): Promise<PackSheetResult> {
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
  const padding = opts.padding && opts.padding > 0 ? Math.floor(opts.padding) : 0;
  const trim = opts.trim === true;
  const durationMs = fps > 0 ? Math.round(1000 / fps) : 0;

  // Cell pitch includes padding between and around every cell.
  const pitchX = frameWidth + padding;
  const pitchY = frameHeight + padding;
  let atlasW = padding + columns * pitchX;
  let atlasH = padding + rows * pitchY;
  if (opts.powerOfTwo) {
    atlasW = nextPow2(atlasW);
    atlasH = nextPow2(atlasH);
  }

  const frameRects: FrameRect[] = [];
  const atlasImg = new Jimp({ width: atlasW, height: atlasH, color: 0x00000000 });
  for (let i = 0; i < imgs.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const cx = padding + col * pitchX;
    const cy = padding + row * pitchY;
    atlasImg.composite(imgs[i], cx, cy);

    let rect: FrameRect;
    const tb = trim ? alphaBounds(imgs[i].bitmap) : null;
    if (tb) {
      rect = {
        index: i,
        x: cx + tb.left,
        y: cy + tb.top,
        w: tb.w,
        h: tb.h,
        duration: durationMs,
        trimmed: true,
        spriteSourceSize: { x: tb.left, y: tb.top, w: tb.w, h: tb.h },
        sourceSize: { w: frameWidth, h: frameHeight },
      };
    } else {
      rect = {
        index: i,
        x: cx,
        y: cy,
        w: frameWidth,
        h: frameHeight,
        duration: durationMs,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
        sourceSize: { w: frameWidth, h: frameHeight },
      };
    }
    frameRects.push(rect);
  }
  const atlas = await atlasImg.getBuffer('image/png');

  const atlasPath = opts.outPath;
  const manifestPath = atlasPath.replace(/\.[^.]+$/, '') + '.json';
  const imageName = basename(atlasPath);

  // Clamp animation tag ranges to valid frame indices.
  const animations: AnimationTag[] = (opts.animations ?? []).map((a) => ({
    ...a,
    from: Math.max(0, Math.min(count - 1, a.from)),
    to: Math.max(0, Math.min(count - 1, a.to)),
  }));

  const manifest: SpriteSheetManifest = {
    frameWidth,
    frameHeight,
    columns,
    rows,
    count,
    fps,
    padding,
    atlasWidth: atlasW,
    atlasHeight: atlasH,
    image: imageName,
    animations,
    frames: frameRects.sort((a, b) => a.index - b.index),
  };

  writeFileSync(atlasPath, atlas);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Engine export sidecars.
  const exports: Partial<Record<ExportFormat, { path: string; content: string }>> = {};
  if (opts.exportFormats && opts.exportFormats.length) {
    const exportManifest: ExportManifest = {
      atlasWidth: atlasW,
      atlasHeight: atlasH,
      image: imageName,
      fps,
      animations,
      frames: frameRects as ExportFrame[],
    };
    const exportBase = imageName.replace(/\.[^.]+$/, '');
    const sidecarBase = atlasPath.replace(/\.[^.]+$/, '');
    for (const format of opts.exportFormats) {
      const { ext, content } = buildExport(format, exportManifest, exportBase);
      const path = `${sidecarBase}.${ext}`;
      writeFileSync(path, content);
      exports[format] = { path, content };
    }
  }

  return { atlasPath, manifestPath, manifest, exports };
}
