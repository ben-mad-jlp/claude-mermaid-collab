/**
 * MCP Snippet Tools
 *
 * CRUD operations for code snippets stored as .snippet files in session folders.
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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

export interface CreateSnippetResult {
  success: boolean;
  id: string;
}

export interface UpdateSnippetResult {
  success: boolean;
  id: string;
}

export interface GetSnippetResult {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface ListSnippetsResult {
  snippets: Array<{ id: string; name: string; lastModified?: number }>;
}

export interface DeleteSnippetResult {
  success: boolean;
}

export interface ExportSnippetResult {
  success: boolean;
  filePath: string;
  format: string;
  size: number;
}

// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name. Either session or todoId is required.' },
  todoId: { type: 'number', description: 'Todo ID. Alternative to session - will resolve to the todo\'s session.' },
};

export const createSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Snippet name' },
    content: { type: 'string', description: 'Snippet content (code)' },
  },
  required: ['project', 'name', 'content'],
};

export const updateSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID' },
    content: { type: 'string', description: 'Updated snippet content' },
  },
  required: ['project', 'id', 'content'],
};

export const getSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID' },
  },
  required: ['project', 'id'],
};

export const listSnippetsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

export const deleteSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID' },
  },
  required: ['project', 'id'],
};

export const exportSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID to export' },
    format: { type: 'string', enum: ['text', 'json'], description: 'Export format (text or json). Default: text' },
    outputPath: { type: 'string', description: 'File path to save the exported snippet. If not provided, saves to a temp file.' },
  },
  required: ['project', 'id'],
};

// ============= Handlers =============

export async function handleCreateSnippet(
  project: string,
  session: string,
  name: string,
  content: string
): Promise<CreateSnippetResult> {
  const response = await fetch(buildUrl('/api/snippet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create snippet: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return { success: true, id: data.id };
}

export async function handleUpdateSnippet(
  project: string,
  session: string,
  id: string,
  content: string
): Promise<UpdateSnippetResult> {
  const response = await fetch(buildUrl(`/api/snippet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update snippet: ${error.error || response.statusText}`);
  }

  return { success: true, id };
}

export async function handleGetSnippet(
  project: string,
  session: string,
  id: string
): Promise<GetSnippetResult> {
  const response = await fetch(buildUrl(`/api/snippet/${id}`, project, session));

  if (!response.ok) {
    throw new Error(`Snippet not found: ${id}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name || data.id,
    content: data.content,
    lastModified: data.lastModified,
  };
}

export async function handleListSnippets(
  project: string,
  session: string
): Promise<ListSnippetsResult> {
  const response = await fetch(buildUrl('/api/snippets', project, session));

  if (!response.ok) {
    throw new Error(`Failed to list snippets: ${response.statusText}`);
  }

  const data = await response.json();
  return { snippets: data.snippets || [] };
}

export async function handleDeleteSnippet(
  project: string,
  session: string,
  id: string
): Promise<DeleteSnippetResult> {
  const response = await fetch(buildUrl(`/api/snippet/${id}`, project, session), {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to delete snippet: ${error.error || response.statusText}`);
  }

  return { success: true };
}

export async function handleExportSnippet(
  project: string,
  session: string,
  id: string,
  format: string = 'text',
  outputPath?: string
): Promise<ExportSnippetResult> {
  // Get the snippet first
  const snippet = await handleGetSnippet(project, session, id);

  let fileContent: string;
  let ext: string;

  if (format === 'json') {
    fileContent = JSON.stringify({
      id: snippet.id,
      name: snippet.name,
      content: snippet.content,
      lastModified: snippet.lastModified,
    }, null, 2);
    ext = 'json';
  } else {
    fileContent = snippet.content;
    ext = 'txt';
  }

  const filePath = outputPath || join(tmpdir(), `snippet-${id}-${Date.now()}.${ext}`);
  await writeFile(filePath, fileContent);

  return { success: true, filePath, format: ext, size: fileContent.length };
}
