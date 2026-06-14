/**
 * Engine-ready export-format serializers for a packed sprite sheet (T1).
 *
 * packSheet builds an extended manifest (frame rects + per-frame durations +
 * named animation tags); these pure functions turn that manifest into the JSON /
 * resource formats game engines import directly:
 *   - Aseprite JSON hash  (frames{} + meta.frameTags)  → Aseprite, Phaser `load.aseprite`
 *   - TexturePacker JSON hash                           → Phaser/PixiJS `load.atlas`
 *   - Godot 4 SpriteFrames `.tres`                      → Godot AnimatedSprite2D
 *
 * Pure string builders — no filesystem, no image deps — so they unit-test in isolation.
 */

export interface AnimationTag {
  /** Animation name (becomes the Aseprite frameTag / Godot animation name). */
  name: string;
  /** First frame index (inclusive). */
  from: number;
  /** Last frame index (inclusive). */
  to: number;
  /** Playback direction. Default 'forward'. */
  direction?: 'forward' | 'reverse' | 'pingpong';
  /** Repeat count; 0 = loop forever. Default 0 (loop). */
  repeat?: number;
}

export interface ExportFrame {
  index: number;
  /** Position + size of the (possibly trimmed) frame within the atlas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-frame display duration in ms (derived from fps). */
  duration: number;
  /** Whether transparent margins were trimmed off. */
  trimmed: boolean;
  /** Offset + tight size of the trimmed sprite inside the original frame. */
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  /** Original (untrimmed) frame size. */
  sourceSize: { w: number; h: number };
}

export interface ExportManifest {
  atlasWidth: number;
  atlasHeight: number;
  /** Atlas image filename the export references (e.g. `hero-sheet.png`). */
  image: string;
  frames: ExportFrame[];
  animations: AnimationTag[];
  fps: number;
}

export type ExportFormat = 'aseprite' | 'phaser' | 'godot';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['aseprite', 'phaser', 'godot'];

export function isExportFormat(v: string): v is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(v);
}

/** Parse a comma-separated string or array into a deduped list of valid formats. */
export function normalizeExportFormats(input: unknown): ExportFormat[] {
  if (!input) return [];
  const parts = Array.isArray(input)
    ? input.map((v) => String(v))
    : String(input).split(',');
  const out: ExportFormat[] = [];
  for (const p of parts) {
    const f = p.trim().toLowerCase();
    if (isExportFormat(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

function frameKey(base: string, index: number, ext: string): string {
  return `${base} ${index}.${ext}`;
}

/** Aseprite JSON hash — `frames` object keyed by name, `meta.frameTags` for animations. */
export function toAseprite(m: ExportManifest, baseName: string): string {
  const frames: Record<string, unknown> = {};
  for (const f of m.frames) {
    frames[frameKey(baseName, f.index, 'aseprite')] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: f.spriteSourceSize,
      sourceSize: f.sourceSize,
      duration: f.duration,
    };
  }
  const frameTags = m.animations.map((a) => ({
    name: a.name,
    from: a.from,
    to: a.to,
    direction: a.direction ?? 'forward',
    color: '#000000ff',
    repeat: String(a.repeat ?? 0),
  }));
  return JSON.stringify(
    {
      frames,
      meta: {
        app: 'mermaid-collab',
        version: '1.0',
        image: m.image,
        format: 'RGBA8888',
        size: { w: m.atlasWidth, h: m.atlasHeight },
        scale: '1',
        frameTags,
        layers: [],
        slices: [],
      },
    },
    null,
    2,
  );
}

/** TexturePacker JSON hash — the format Phaser/PixiJS `load.atlas` consumes. */
export function toPhaser(m: ExportManifest, baseName: string): string {
  const frames: Record<string, unknown> = {};
  for (const f of m.frames) {
    frames[frameKey(baseName, f.index, 'png')] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: f.spriteSourceSize,
      sourceSize: f.sourceSize,
    };
  }
  return JSON.stringify(
    {
      frames,
      meta: {
        app: 'mermaid-collab',
        version: '1.0',
        image: m.image,
        format: 'RGBA8888',
        size: { w: m.atlasWidth, h: m.atlasHeight },
        scale: '1',
        // Phaser reads frameTags via its Aseprite loader; carried here for tooling parity.
        frameTags: m.animations.map((a) => ({ name: a.name, from: a.from, to: a.to, direction: a.direction ?? 'forward' })),
      },
    },
    null,
    2,
  );
}

/** Godot 4 SpriteFrames `.tres` — one AtlasTexture sub-resource per frame, grouped into animations. */
export function toGodot(m: ExportManifest, baseName: string): string {
  const lines: string[] = [];
  const subCount = m.frames.length;
  // load_steps = ext_resources (1) + sub_resources (N) + the [resource] block (1).
  const loadSteps = subCount + 2;
  lines.push(`[gd_resource type="SpriteFrames" load_steps=${loadSteps} format=3]`);
  lines.push('');
  lines.push(`[ext_resource type="Texture2D" path="res://${m.image}" id="1_atlas"]`);
  lines.push('');

  for (const f of m.frames) {
    lines.push(`[sub_resource type="AtlasTexture" id="frame_${f.index}"]`);
    lines.push('atlas = ExtResource("1_atlas")');
    lines.push(`region = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})`);
    lines.push('');
  }

  // No tags → a single "default" animation over every frame.
  const tags: AnimationTag[] = m.animations.length
    ? m.animations
    : [{ name: 'default', from: 0, to: Math.max(0, subCount - 1), direction: 'forward', repeat: 0 }];

  const speed = m.fps > 0 ? m.fps : 5;
  const animBlocks = tags.map((a) => {
    const order: number[] = [];
    if (a.direction === 'reverse') {
      for (let i = a.to; i >= a.from; i--) order.push(i);
    } else {
      for (let i = a.from; i <= a.to; i++) order.push(i);
      if (a.direction === 'pingpong') for (let i = a.to - 1; i > a.from; i--) order.push(i);
    }
    const frameEntries = order
      .map((i) => `{\n"duration": 1.0,\n"texture": SubResource("frame_${i}")\n}`)
      .join(', ');
    const loop = (a.repeat ?? 0) === 0 ? 'true' : 'false';
    return `{\n"frames": [${frameEntries}],\n"loop": ${loop},\n"name": &"${a.name}",\n"speed": ${speed.toFixed(3)}\n}`;
  });

  lines.push('[resource]');
  lines.push(`animations = [${animBlocks.join(', ')}]`);
  lines.push('');
  return lines.join('\n');
}

export function buildExport(format: ExportFormat, m: ExportManifest, baseName: string): { ext: string; content: string } {
  switch (format) {
    case 'aseprite':
      return { ext: 'aseprite.json', content: toAseprite(m, baseName) };
    case 'phaser':
      return { ext: 'phaser.json', content: toPhaser(m, baseName) };
    case 'godot':
      return { ext: 'godot.tres', content: toGodot(m, baseName) };
  }
}
