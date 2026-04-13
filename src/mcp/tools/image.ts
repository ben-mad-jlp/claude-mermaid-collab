const API_PORT = parseInt(process.env.PORT || '3737', 10);
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
