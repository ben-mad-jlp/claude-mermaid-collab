/**
 * MCP Code Tools
 *
 * Tools for linking, pushing, syncing, and reviewing code files
 * stored as linked snippet envelopes.
 */

import { stat, readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { createPatch } from 'diff';
import { validatePathUnderRoot, isBinaryFile } from '../../utils/path-security.js';

// ============= Constants =============

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

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name. Either session or todoId is required.' },
  todoId: { type: 'number', description: 'Todo ID. Alternative to session - will resolve to the todo\'s session.' },
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp', h: 'cpp', hpp: 'cpp',
  css: 'css',
  html: 'html', htm: 'html',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  sh: 'shell', bash: 'shell',
  sql: 'sql',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
};

// ============= Schemas =============

export const linkCodeFileSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    filePath: { type: 'string', description: 'Absolute path to the file to link' },
    name: { type: 'string', description: 'Display name for the linked file (defaults to basename)' },
  },
  required: ['project', 'session', 'filePath'],
};

export const pushCodeToFileSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID of the linked code file' },
  },
  required: ['project', 'session', 'id'],
};

export const syncCodeFromDiskSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID of the linked code file' },
  },
  required: ['project', 'session', 'id'],
};

export const reviewCodeEditsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID of the linked code file' },
    format: { type: 'string', enum: ['diff', 'full'], description: 'Output format: diff (unified diff) or full (all fields). Default: diff' },
  },
  required: ['project', 'session', 'id'],
};

export const listCodeFilesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

// ============= Handlers =============

export async function handleLinkCodeFile(
  project: string,
  session: string,
  filePath: string,
  name?: string,
): Promise<{ success: boolean; id: string }> {
  const resolvedPath = await validatePathUnderRoot(filePath, project);

  const fileStat = await stat(resolvedPath);
  if (fileStat.size >= 1_000_000) {
    throw new Error(`File too large (${fileStat.size} bytes). Maximum is 1MB.`);
  }

  const binary = await isBinaryFile(resolvedPath);
  if (binary) {
    throw new Error('Cannot link binary files');
  }

  const content = await readFile(resolvedPath, 'utf-8');
  const language = EXT_TO_LANGUAGE[extname(resolvedPath).slice(1).toLowerCase()] || 'text';

  const envelope = {
    code: content,
    language,
    filePath: resolvedPath,
    originalCode: content,
    diskCode: content,
    linked: true,
    linkCreatedAt: Date.now(),
    lastPushedAt: null,
    lastSyncedAt: Date.now(),
    dirty: false,
  };

  const response = await fetch(buildUrl('/api/snippet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || basename(resolvedPath), content: JSON.stringify(envelope) }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to link code file: ${error.error || response.statusText}`);
  }

  const data = await response.json() as any;
  return { success: true, id: data.id };
}

export async function handlePushCodeToFile(
  project: string,
  session: string,
  id: string,
): Promise<{ success: boolean; filePath: string; bytesWritten: number }> {
  const response = await fetch(buildUrl(`/api/code/push/${id}`, project, session), {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to push code to file: ${error.error || response.statusText}`);
  }

  return await response.json() as any;
}

export async function handleSyncCodeFromDisk(
  project: string,
  session: string,
  id: string,
): Promise<{ success: boolean; diskChanged: boolean; hasLocalEdits: boolean; conflict: boolean }> {
  const response = await fetch(buildUrl(`/api/code/sync/${id}`, project, session), {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to sync from disk: ${error.error || response.statusText}`);
  }

  return await response.json() as any;
}

export async function handleReviewCodeEdits(
  project: string,
  session: string,
  id: string,
  format: 'diff' | 'full' = 'diff',
): Promise<Record<string, unknown>> {
  const response = await fetch(buildUrl(`/api/snippet/${id}`, project, session));

  if (!response.ok) {
    throw new Error(`Snippet not found: ${id}`);
  }

  const data = await response.json() as any;
  const envelope = JSON.parse(data.content);

  if (format === 'diff') {
    const diff = createPatch(
      'changes',
      envelope.originalCode || '',
      envelope.code || '',
    );
    return {
      id,
      filePath: envelope.filePath,
      language: envelope.language,
      diff,
    };
  }

  // format === 'full'
  return {
    id,
    filePath: envelope.filePath,
    language: envelope.language,
    code: envelope.code,
    originalCode: envelope.originalCode,
    diskCode: envelope.diskCode,
    dirty: envelope.dirty,
    lastPushedAt: envelope.lastPushedAt,
  };
}

export async function handleListCodeFiles(
  project: string,
  session: string,
): Promise<{ files: Array<{ id: string; name: string; filePath: string; language: string; dirty: boolean; lastPushedAt: string | null }> }> {
  const response = await fetch(buildUrl('/api/snippets', project, session));

  if (!response.ok) {
    throw new Error(`Failed to list snippets: ${response.statusText}`);
  }

  const data = await response.json() as any;
  const snippets: any[] = data.snippets || [];

  const files: Array<{ id: string; name: string; filePath: string; language: string; dirty: boolean; lastPushedAt: string | null }> = [];

  for (const snippet of snippets) {
    try {
      const envelope = JSON.parse(snippet.content);
      if (envelope.linked === true) {
        files.push({
          id: snippet.id,
          name: snippet.name,
          filePath: envelope.filePath,
          language: envelope.language,
          dirty: envelope.dirty,
          lastPushedAt: envelope.lastPushedAt,
        });
      }
    } catch {
      // Not JSON or not a linked snippet — skip
    }
  }

  return { files };
}
