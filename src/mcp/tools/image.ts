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
