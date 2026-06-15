const API_PORT = parseInt(process.env.PORT || '9002', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

function buildUrl(path: string, project: string, session: string, extraParams?: Record<string, string>): string {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export interface CreateImageResult {
  success: boolean;
  id: string;
}

export interface ListImagesResult {
  images: Array<{ id: string; name: string; mimeType: string; size: number; uploadedAt: string }>;
}

export interface GetImageResult {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  ext: string;
  path: string;
}

export interface DeleteImageResult {
  success: boolean;
}

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name.' },
};

export interface GenerateImageResult {
  success: boolean;
  images: Array<{ id: string; name: string; mimeType: string; size: number }>;
  costUsd: number;
  model: string;
  finalPrompt: string;
}

export const generateImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    prompt: { type: 'string', description: 'What to generate, in plain language.' },
    name: { type: 'string', description: 'Base filename for the saved image (optional; derived from the prompt if omitted).' },
    task: { type: 'string', enum: ['icon', 'sprite', 'concept', 'prop'], description: "Preset that shapes the prompt. 'icon' wraps it as a flat app icon; others pass through (optional)." },
    model: { type: 'string', description: 'xAI model id (default grok-imagine-image-quality; grok-imagine-image is cheaper).' },
    n: { type: 'number', description: 'Number of images (1-4, default 1).' },
    aspectRatio: { type: 'string', description: "e.g. '1:1', '16:9' (optional, default 1:1)." },
    resolution: { type: 'string', enum: ['1k', '2k'], description: "'1k' (1024 jpeg, ~$0.05) or '2k' (2048 png, ~$0.07). Default 1k." },
  },
  required: ['project', 'session', 'prompt'],
};

export interface GenerateSpriteResult {
  success: boolean;
  mode: 'animation' | 'rotation';
  sheet: { id: string; name: string; size: number };
  manifest: unknown;
  exports?: Record<string, string>;
  frameCount: number;
  costUsd: number;
  model: string;
}

const seedDesc = {
  seedImageId: { type: 'string', description: 'Use an existing session image as the seed (its id). The seed should be on a solid chroma background with the key color absent from the character.' },
  seedSource: { type: 'string', description: 'Seed image as a file path, URL, or base64 data URI (alternative to seedImageId).' },
  seedPrompt: { type: 'string', description: 'Generate the seed image first from this prompt (alternative to seedImageId/seedSource). Describe a solid-chroma-green background with NO green on the character.' },
};
const spriteCommon = {
  ...sessionParamsDesc,
  ...seedDesc,
  name: { type: 'string', description: 'Base filename for the saved sprite sheet (optional).' },
  model: { type: 'string', description: 'xAI video model (default grok-imagine-video; grok-imagine-video-1.5-preview is higher-fidelity/lower-steering).' },
  frames: { type: 'number', description: 'Number of frames to extract from the clip (2-64).' },
  fps: { type: 'number', description: 'Animation fps recorded in the manifest.' },
  columns: { type: 'number', description: 'Atlas grid columns (default ~sqrt(frames)).' },
  keyColor: { type: 'string', description: "Chroma key color, hex (default '#00b140')." },
  tolerance: { type: 'number', description: 'Chroma key tolerance (default 100).' },
  pixelHeight: { type: 'number', description: 'Target sprite pixel height (default 128).' },
  padding: { type: 'number', description: 'Px gap between and around atlas cells to prevent texture bleed (default 0).' },
  powerOfTwo: { type: 'boolean', description: 'Round the atlas up to power-of-two dimensions (default false).' },
  trim: { type: 'boolean', description: 'Trim transparent margins per frame; records tight rect + source offsets (default false).' },
  exportFormat: { type: 'string', description: "Engine export sidecars to also emit (returned in `exports`), comma-separated: aseprite, phaser, godot. Default none (three.js manifest only)." },
};

export const generateSpriteAnimationSchema = {
  type: 'object',
  properties: {
    ...spriteCommon,
    prompt: { type: 'string', description: 'The action to animate (e.g. "punches forward", "idle ready stance"). Required.' },
  },
  required: ['project', 'session', 'prompt'],
};

export const generateSpriteRotationSchema = {
  type: 'object',
  properties: {
    ...spriteCommon,
    prompt: { type: 'string', description: 'Optional extra direction for the turntable (the camera-orbit framing is added automatically).' },
  },
  required: ['project', 'session'],
};

export interface GenerateSpriteSheetResult {
  success: boolean;
  sheet: { id: string; name: string; size: number };
  manifest: unknown;
  exports?: Record<string, string>;
  frames: number;
  angles: number;
  cellCount: number;
  costUsd: number;
  model: string;
}

export const generateSpriteSheetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    character: { type: 'string', description: 'Description of the character (e.g. "8-bit pixel art female punk rocker with a pink mohawk"). Drives consistency when no seed image is given.' },
    animation: { type: 'string', description: 'The action to animate (e.g. "a punch attack", "a walk cycle").' },
    name: { type: 'string', description: 'Base filename for the saved sheet (optional; defaults from character).' },
    seedImageId: { type: 'string', description: 'Optional: an existing session image id to LOCK the character (img2img). The generated poses will match this reference, and the pedestal marker color is auto-picked to be absent from it.' },
    seedSource: { type: 'string', description: 'Optional alternative to seedImageId: a file path, URL, or base64 data URI for the character reference.' },
    frames: { type: 'number', description: 'Animation frames / poses (2-8; >8 the model clones poses). Default 6.' },
    angles: { type: 'number', description: 'Facing angles sampled from the turntable orbit (2-16). Default 8.' },
    fps: { type: 'number', description: 'Animation fps recorded in the manifest. Default 12.' },
    cellWidth: { type: 'number', description: 'Output cell width px. Default 96.' },
    cellHeight: { type: 'number', description: 'Output cell height px. Default 128.' },
    keyColor: { type: 'string', description: "Chroma background key (default '#00b140')." },
    markerColor: { type: 'string', description: "Pedestal/marker color removed alongside the background. Default: auto-picked absent from the seed character, else cyan '#00ecf8'." },
    model: { type: 'string', description: 'xAI video model (default grok-imagine-video).' },
    padding: { type: 'number', description: 'Px gap between and around atlas cells to prevent texture bleed (default 0).' },
    powerOfTwo: { type: 'boolean', description: 'Round the atlas up to power-of-two dimensions (default false).' },
    trim: { type: 'boolean', description: 'Trim transparent margins per cell; records tight rect + source offsets (default false).' },
    exportFormat: { type: 'string', description: "Engine export sidecars to also emit (returned in `exports`), comma-separated: aseprite, phaser, godot. One animation tag per angle row. Default none." },
  },
  required: ['project', 'session', 'character', 'animation'],
};

export const createImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Image display name (filename)' },
    source: { type: 'string', description: 'Image source: file path, URL, or base64 data URI (data:image/png;base64,...)' },
  },
  required: ['project', 'session', 'name', 'source'],
};

export const listImagesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

export const getImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Image ID' },
  },
  required: ['project', 'session', 'id'],
};

export const deleteImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Image ID' },
  },
  required: ['project', 'session', 'id'],
};

export async function handleGenerateImage(
  project: string,
  session: string,
  args: { prompt: string; name?: string; task?: string; model?: string; n?: number; aspectRatio?: string; resolution?: string },
): Promise<GenerateImageResult> {
  const response = await fetch(buildUrl('/api/generate-image', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText })) as any;
    throw new Error(`Failed to generate image: ${error.error || response.statusText}`);
  }

  return await response.json() as GenerateImageResult;
}

export async function handleGenerateSprite(
  project: string,
  session: string,
  mode: 'animation' | 'rotation',
  args: Record<string, unknown>,
): Promise<GenerateSpriteResult> {
  const response = await fetch(buildUrl('/api/generate-sprite', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, mode }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText })) as any;
    throw new Error(`Failed to generate sprite: ${error.error || response.statusText}`);
  }

  return await response.json() as GenerateSpriteResult;
}

export const generateVoiceoverSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    text: { type: 'string', description: 'What to say (e.g. "Round one. Fight!").' },
    voiceId: { type: 'string', enum: ['eve', 'ara', 'rex', 'sal', 'leo'], description: 'Grok voice (default eve).' },
    language: { type: 'string', description: "BCP-47 or 'auto'. Default 'en'." },
    speed: { type: 'number', description: '0.7–1.5. Default 1.0.' },
    dspPreset: { type: 'string', description: 'Optional shared DSP preset to make it epic (epic-announcer, ice-demon, giant, robot-8bit, radio, ghost, hype…). See list_dsp_presets.' },
    codec: { type: 'string', enum: ['mp3', 'wav'], description: 'Output codec (default mp3).' },
    name: { type: 'string', description: 'Base filename (optional).' },
  },
  required: ['project', 'session', 'text'],
};

export const applyAudioDspSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    audioId: { type: 'string', description: 'Existing audio artifact id (voice, SFX, or music — the same presets apply to all).' },
    preset: { type: 'string', description: 'DSP preset name (see list_dsp_presets) or a raw ffmpeg -af filterchain.' },
    name: { type: 'string', description: 'Base filename for the processed audio (optional).' },
  },
  required: ['project', 'session', 'audioId', 'preset'],
};

export const listAudioSchema = { type: 'object', properties: { ...sessionParamsDesc }, required: ['project', 'session'] };
export const listDspPresetsSchema = { type: 'object', properties: { ...sessionParamsDesc }, required: ['project', 'session'] };

export async function handleGenerateVoiceover(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-voiceover', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate voiceover: ${e.error || r.statusText}`); }
  return r.json();
}
export async function handleApplyAudioDsp(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/apply-audio-dsp', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to apply audio dsp: ${e.error || r.statusText}`); }
  return r.json();
}
export async function handleListAudio(project: string, session: string): Promise<any> {
  const r = await fetch(buildUrl('/api/audio', project, session));
  if (!r.ok) throw new Error(`Failed to list audio: ${r.statusText}`);
  return r.json();
}
export async function handleListDspPresets(project: string, session: string): Promise<any> {
  const r = await fetch(buildUrl('/api/dsp-presets', project, session));
  if (!r.ok) throw new Error(`Failed to list dsp presets: ${r.statusText}`);
  return r.json();
}

export const estimateCostSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    op: { type: 'string', description: 'Operation: image | prop | sprite_sheet | sprite_animation | sprite_rotation | vfx | tileset | background | character_animations | voiceover.' },
    params: { type: 'object', description: 'Op params for the estimate, e.g. {actions:5} or {tiles:8} or {layers:2} or {chars:120}.' },
  },
  required: ['project', 'session', 'op'],
};

export const assetBudgetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    budgetUsd: { type: ['number', 'null'], description: 'Set a session spend cap in USD (generations 402 when it would be exceeded); null clears it. Omit to just read current spend.' },
  },
  required: ['project', 'session'],
};

export const replaceSheetCellSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    sheetImageId: { type: 'string', description: 'The sprite sheet / tileset image id to patch.' },
    replacementImageId: { type: 'string', description: 'The image to composite into the cell (autocropped + centered to fit).' },
    cellIndex: { type: 'number', description: 'Cell index from the sheet manifest (alternative to rect).' },
    rect: { type: 'object', description: 'Explicit target rect {x,y,w,h} (alternative to cellIndex).' },
    name: { type: 'string', description: 'Base filename for the patched sheet (optional).' },
  },
  required: ['project', 'session', 'sheetImageId', 'replacementImageId'],
};

export async function handleEstimateCost(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/estimate-cost', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to estimate cost: ${e.error || r.statusText}`); }
  return r.json();
}

export async function handleAssetBudget(project: string, session: string, args: { budgetUsd?: number | null }): Promise<any> {
  if (Object.prototype.hasOwnProperty.call(args, 'budgetUsd')) {
    const r = await fetch(buildUrl('/api/asset-budget', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to set budget: ${e.error || r.statusText}`); }
    return r.json();
  }
  const r = await fetch(buildUrl('/api/asset-spend', project, session));
  if (!r.ok) throw new Error(`Failed to read spend: ${r.statusText}`);
  return r.json();
}

export async function handleReplaceSheetCell(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/replace-sheet-cell', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to replace cell: ${e.error || r.statusText}`); }
  return r.json();
}

export const generateTilesetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    prompt: { type: 'string', description: 'Single tile description (e.g. "mossy stone floor"). Use tiles[] for a set.' },
    tiles: { type: 'array', items: { type: 'string' }, description: 'Multiple tile descriptions → a packed tilesheet.' },
    tileSize: { type: 'number', description: 'Tile pixel size (square). Default 32.' },
    columns: { type: 'number', description: 'Tilesheet columns (default ~min(8,count)).' },
    heal: { type: 'boolean', description: 'Offset-blend each tile to enforce seamlessness (default true).' },
    name: { type: 'string', description: 'Base filename (optional).' },
    model: { type: 'string', description: 'xAI image model (optional).' },
  },
  required: ['project', 'session'],
};

export const generateBackgroundSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    prompt: { type: 'string', description: 'The scene (e.g. "an ice hockey arena at night").' },
    aspectRatio: { type: 'string', description: "Default '16:9'." },
    tileableX: { type: 'boolean', description: 'Make the base horizontally seamless for looping scroll (default false).' },
    layers: { type: 'array', items: { type: 'string' }, description: 'Optional parallax foreground layers (each generated transparent, e.g. ["foreground crowd","ice rink rail"]).' },
    pixelHeight: { type: 'number', description: 'Optional downscale target height.' },
    keyColor: { type: 'string', description: "Chroma key for transparent layers (default '#00b140')." },
    name: { type: 'string', description: 'Base filename (optional).' },
    model: { type: 'string', description: 'xAI image model (optional).' },
  },
  required: ['project', 'session', 'prompt'],
};

export async function handleGenerateTileset(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-tileset', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate tileset: ${e.error || r.statusText}`); }
  return r.json();
}

export async function handleGenerateBackground(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-background', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate background: ${e.error || r.statusText}`); }
  return r.json();
}

export const generateVfxSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    prompt: { type: 'string', description: 'The effect (e.g. "an explosion", "ice spray burst", "blue hit spark").' },
    name: { type: 'string', description: 'Base filename (optional).' },
    frames: { type: 'number', description: 'Frames to extract (2-32). Default 8.' },
    fps: { type: 'number', description: 'Animation fps. Default 16.' },
    keyMode: { type: 'string', enum: ['chroma', 'luminance'], description: "'chroma' (solid bg key) or 'luminance' (alpha from brightness — for glowy/additive effects on black). Default chroma." },
    keyColor: { type: 'string', description: "Chroma key color (default '#00b140')." },
    pixelHeight: { type: 'number', description: 'Target pixel height. Default 128.' },
    loop: { type: 'boolean', description: 'Seamless loop (default true) vs one-shot.' },
    exportFormat: { type: 'string', description: 'Engine export sidecars: aseprite, phaser, godot (comma-separated).' },
    model: { type: 'string', description: 'xAI video model (default grok-imagine-video).' },
  },
  required: ['project', 'session', 'prompt'],
};

export const generatePropSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    prompt: { type: 'string', description: 'The item/prop/icon (e.g. "a health potion", "a steel sword").' },
    name: { type: 'string', description: 'Base filename (optional).' },
    task: { type: 'string', enum: ['icon', 'sprite', 'prop'], description: 'Preset shaping the prompt (default prop).' },
    transparent: { type: 'boolean', description: 'Chroma-key to a transparent PNG (default true).' },
    pixelHeight: { type: 'number', description: 'Optional downscale target height.' },
    keyColor: { type: 'string', description: "Chroma key color (default '#00b140')." },
    model: { type: 'string', description: 'xAI image model (optional).' },
  },
  required: ['project', 'session', 'prompt'],
};

export async function handleGenerateVfx(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-vfx', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate vfx: ${e.error || r.statusText}`); }
  return r.json();
}

export async function handleGenerateProp(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-prop', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate prop: ${e.error || r.statusText}`); }
  return r.json();
}

export const defineCharacterSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Character name (also the id slug).' },
    description: { type: 'string', description: 'What the character looks like. If no referenceImageId is given, a canonical reference image is generated from this and locked in.' },
    referenceImageId: { type: 'string', description: 'Existing session image to use as the locked reference (optional; else one is generated from description).' },
    palette: { type: 'array', items: { type: 'string' }, description: 'Optional fixed hex palette for this character.' },
    stylePromptFragment: { type: 'string', description: 'Optional aesthetic phrase appended to this character\'s prompts.' },
    generateReference: { type: 'boolean', description: 'Generate a canonical reference image from description (default true when no referenceImageId).' },
  },
  required: ['project', 'session', 'name'],
};

export const listCharactersSchema = {
  type: 'object',
  properties: { ...sessionParamsDesc },
  required: ['project', 'session'],
};

export const generateCharacterAnimationsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    character: { type: 'string', description: 'Name of a defined character (see define_character).' },
    actions: { type: 'array', items: { type: 'string' }, description: 'Explicit list of animations (e.g. ["idle","skate","punch","KO"]).' },
    preset: { type: 'string', description: 'Named action bundle: fighter / platformer / topdown. Merged with actions[].' },
    frames: { type: 'number', description: 'Animation frames per sheet (2-8). Default 6.' },
    angles: { type: 'number', description: 'Facing angles per sheet (2-16). Default 8.' },
    fps: { type: 'number', description: 'Animation fps. Default 12.' },
    exportFormat: { type: 'string', description: 'Engine export sidecars per sheet: aseprite, phaser, godot (comma-separated).' },
    model: { type: 'string', description: 'xAI video model (default grok-imagine-video).' },
  },
  required: ['project', 'session', 'character'],
};

export async function handleDefineCharacter(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/character', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to define character: ${e.error || r.statusText}`); }
  return r.json();
}

export async function handleListCharacters(project: string, session: string): Promise<any> {
  const r = await fetch(buildUrl('/api/characters', project, session));
  if (!r.ok) throw new Error(`Failed to list characters: ${r.statusText}`);
  return r.json();
}

export async function handleGenerateCharacterAnimations(project: string, session: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(buildUrl('/api/generate-character-animations', project, session), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })) as any; throw new Error(`Failed to generate character animations: ${e.error || r.statusText}`); }
  return r.json();
}

export async function handleGenerateSpriteSheet(
  project: string,
  session: string,
  args: Record<string, unknown>,
): Promise<GenerateSpriteSheetResult> {
  const response = await fetch(buildUrl('/api/generate-sprite-sheet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText })) as any;
    throw new Error(`Failed to generate sprite sheet: ${error.error || response.statusText}`);
  }
  return await response.json() as GenerateSpriteSheetResult;
}

export async function handleCreateImage(
  project: string,
  session: string,
  name: string,
  source: string,
): Promise<CreateImageResult> {
  const response = await fetch(buildUrl('/api/image', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, source }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText })) as any;
    throw new Error(`Failed to create image: ${error.error || response.statusText}`);
  }

  const data = await response.json() as any;
  return { success: true, id: data.id };
}

export async function handleListImages(
  project: string,
  session: string,
): Promise<ListImagesResult> {
  const response = await fetch(buildUrl('/api/images', project, session));
  if (!response.ok) throw new Error(`Failed to list images: ${response.statusText}`);
  const data = await response.json() as any;
  return { images: data.images || [] };
}

export async function handleGetImage(
  project: string,
  session: string,
  id: string,
): Promise<GetImageResult> {
  const response = await fetch(buildUrl(`/api/image/${encodeURIComponent(id)}`, project, session));
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Image not found: ${id}`);
    throw new Error(`Failed to get image: ${response.statusText}`);
  }
  return await response.json() as GetImageResult;
}

export async function handleDeleteImage(
  project: string,
  session: string,
  id: string,
): Promise<DeleteImageResult> {
  const response = await fetch(buildUrl(`/api/image/${encodeURIComponent(id)}`, project, session), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText })) as any;
    throw new Error(`Failed to delete image: ${error.error || response.statusText}`);
  }
  return { success: true };
}
