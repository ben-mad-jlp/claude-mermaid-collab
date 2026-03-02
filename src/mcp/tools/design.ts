/**
 * MCP Design Tools
 *
 * CRUD operations for design files stored as .design.json in session folders.
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

export interface DesignRoot {
  [key: string]: any;
}

export interface CreateDesignResult {
  success: boolean;
  id: string;
}

export interface UpdateDesignResult {
  success: boolean;
  id: string;
}

export interface GetDesignResult {
  id: string;
  name: string;
  content: DesignRoot;
  lastModified: number;
}

export interface ListDesignsResult {
  designs: Array<{ id: string; name: string; lastModified?: number }>;
}

export interface DeleteDesignResult {
  success: boolean;
}

// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name. Either session or todoId is required.' },
  todoId: { type: 'number', description: 'Todo ID. Alternative to session - will resolve to the todo\'s session.' },
};

export const createDesignSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Design name (used as file ID)' },
    content: { type: 'object', description: 'Design JSON content (scene graph)' },
  },
  required: ['project', 'name', 'content'],
};

export const updateDesignSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Design ID' },
    content: { type: 'object', description: 'Updated design JSON content' },
  },
  required: ['project', 'id', 'content'],
};

export const getDesignSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Design ID' },
  },
  required: ['project', 'id'],
};

export const listDesignsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

export const deleteDesignSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Design ID' },
  },
  required: ['project', 'id'],
};

// ============= Handlers =============

export async function handleCreateDesign(
  project: string,
  session: string,
  name: string,
  content: any
): Promise<CreateDesignResult> {
  const response = await fetch(buildUrl('/api/design', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create design: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return { success: true, id: data.id };
}

export async function handleUpdateDesign(
  project: string,
  session: string,
  id: string,
  content: any
): Promise<UpdateDesignResult> {
  const response = await fetch(buildUrl(`/api/design/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update design: ${error.error || response.statusText}`);
  }

  return { success: true, id };
}

export async function handleGetDesign(
  project: string,
  session: string,
  id: string
): Promise<GetDesignResult> {
  const response = await fetch(buildUrl(`/api/design/${id}`, project, session));

  if (!response.ok) {
    throw new Error(`Design not found: ${id}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.id,
    content: typeof data.content === 'string' ? JSON.parse(data.content) : data.content,
    lastModified: data.lastModified,
  };
}

export async function handleListDesigns(
  project: string,
  session: string
): Promise<ListDesignsResult> {
  const response = await fetch(buildUrl('/api/designs', project, session));

  if (!response.ok) {
    throw new Error(`Failed to list designs: ${response.statusText}`);
  }

  const data = await response.json();
  return { designs: data.designs || [] };
}

export async function handleDeleteDesign(
  project: string,
  session: string,
  id: string
): Promise<DeleteDesignResult> {
  const response = await fetch(buildUrl(`/api/design/${id}`, project, session), {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to delete design: ${error.error || response.statusText}`);
  }

  return { success: true };
}
