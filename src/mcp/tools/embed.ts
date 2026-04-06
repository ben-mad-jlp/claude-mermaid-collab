/**
 * MCP Embed Tools
 *
 * CRUD operations for embed resources (iframes, Storybook previews, etc.)
 * stored in session folders.
 */

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

// ============= Interfaces =============

export interface CreateEmbedResult {
  success: boolean;
  id: string;
}

export interface ListEmbedsResult {
  embeds: Array<{ id: string; name: string; url: string; subtype?: string }>;
}

export interface DeleteEmbedResult {
  success: boolean;
}

// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name. Either session or todoId is required.' },
  todoId: { type: 'number', description: 'Todo ID. Alternative to session - will resolve to the todo\'s session.' },
};

export const createEmbedSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Display name for the embed' },
    url: { type: 'string', description: 'URL to embed (iframe src)' },
    subtype: { type: 'string', enum: ['storybook'], description: 'Optional embed subtype for specialized rendering' },
    width: { type: 'string', description: 'Optional width for the embed (e.g. "800", "100%")' },
    height: { type: 'string', description: 'Optional height for the embed (e.g. "600", "100%")' },
    storybook: {
      type: 'object',
      description: 'Optional Storybook-specific configuration',
      properties: {
        storyId: { type: 'string', description: 'Storybook story ID (e.g. "components-button--primary")' },
        port: { type: 'number', description: 'Storybook dev server port' },
      },
    },
  },
  required: ['project', 'name', 'url'],
};

export const listEmbedsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

export const deleteEmbedSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Embed ID to delete' },
  },
  required: ['project', 'id'],
};

// ============= Handlers =============

export async function handleCreateEmbed(
  project: string,
  session: string,
  name: string,
  url: string,
  subtype?: string,
  width?: string,
  height?: string,
  storybook?: { storyId: string; port: number },
): Promise<CreateEmbedResult> {
  const body: Record<string, unknown> = { name, url };
  if (subtype !== undefined) body.subtype = subtype;
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;
  if (storybook !== undefined) body.storybook = storybook;

  const response = await fetch(buildUrl('/api/embed', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to create embed: ${error.error || response.statusText}`);
  }

  const data = await response.json() as any;
  return { success: true, id: data.id };
}

export async function handleListEmbeds(
  project: string,
  session: string,
): Promise<ListEmbedsResult> {
  const response = await fetch(buildUrl('/api/embeds', project, session));

  if (!response.ok) {
    throw new Error(`Failed to list embeds: ${response.statusText}`);
  }

  const data = await response.json() as any;
  return { embeds: data.embeds || [] };
}

export async function handleDeleteEmbed(
  project: string,
  session: string,
  id: string,
): Promise<DeleteEmbedResult> {
  const response = await fetch(buildUrl(`/api/embed/${id}`, project, session), {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to delete embed: ${error.error || response.statusText}`);
  }

  return { success: true };
}

// ============= Storybook Schemas =============

export const createStorybookEmbedSchema = {
  type: 'object' as const,
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Display name for the embed' },
    storyId: { type: 'string', description: 'Storybook story ID (e.g., "features-picking-pickingscreen--default")' },
    host: { type: 'string', description: 'Storybook dev server host (default: localhost). Use the machine\'s IP or hostname for remote access.' },
    port: { type: 'number', description: 'Storybook dev server port (default: 6006)' },
  },
  required: ['project', 'name', 'storyId'],
};

export const listStorybookStoriesSchema = {
  type: 'object' as const,
  properties: {
    host: { type: 'string', description: 'Storybook dev server host (default: localhost)' },
    port: { type: 'number', description: 'Storybook dev server port (default: 6006)' },
  },
  required: [],
};

// ============= Storybook Handlers =============

export async function handleCreateStorybookEmbed(
  project: string,
  session: string,
  name: string,
  storyId: string,
  port?: number,
  host?: string,
) {
  const actualPort = port || 6006;
  const actualHost = host || 'localhost';
  const url = `http://${actualHost}:${actualPort}/iframe.html?id=${storyId}&viewMode=story`;
  return handleCreateEmbed(project, session, name, url, 'storybook', undefined, undefined, { storyId, port: actualPort });
}

export async function handleListStorybookStories(port?: number, host?: string) {
  const actualPort = port || 6006;
  const actualHost = host || 'localhost';
  const indexUrl = `http://${actualHost}:${actualPort}/index.json`;
  try {
    const response = await fetch(indexUrl);
    if (!response.ok) {
      throw new Error(`Storybook returned ${response.status}`);
    }
    const data = await response.json();
    const entries = data.entries || {};
    const stories = Object.values(entries)
      .filter((entry: any) => entry.type === 'story')
      .map((entry: any) => ({
        id: entry.id,
        title: entry.title,
        name: entry.name,
        importPath: entry.importPath,
      }));
    return { stories };
  } catch (error: any) {
    return { error: `Could not reach Storybook at http://${actualHost}:${actualPort}. Is the dev server running? (${error.message})` };
  }
}
