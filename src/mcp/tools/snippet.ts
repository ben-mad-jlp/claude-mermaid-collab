/**
 * MCP Snippet Tools
 *
 * CRUD operations for code snippets stored as .snippet files in session folders.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';
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

export interface ApplySnippetResult {
  success: boolean;
  filePath: string;
  linesWritten: number;
  range?: { startLine: number; endLine: number };
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
    name: { type: 'string', description: 'Snippet name. If sourcePath is provided and name is omitted, uses the filename.' },
    content: { type: 'string', description: 'Snippet content (JSON or raw code). Not required if sourcePath is provided.' },
    sourcePath: { type: 'string', description: 'Absolute path to source file. Reads the file, auto-detects language, and sets originalCode.' },
    startLine: { type: 'number', description: 'Start line (1-indexed) for showing a slice of the file. Requires sourcePath.' },
    endLine: { type: 'number', description: 'End line (1-indexed, inclusive) for showing a slice of the file. Requires sourcePath.' },
  },
  required: ['project'],
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

export const applySnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID to apply' },
  },
  required: ['project', 'id'],
};

// ============= Helpers =============

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.js': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python',
  '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.c': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
  '.css': 'css',
  '.html': 'html', '.htm': 'html',
  '.json': 'json',
  '.md': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.sh': 'shell', '.bash': 'shell',
  '.sql': 'sql',
  '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
};

// ============= Handlers =============

export async function handleCreateSnippet(
  project: string,
  session: string,
  name?: string,
  content?: string,
  sourcePath?: string,
  startLine?: number,
  endLine?: number,
): Promise<CreateSnippetResult> {
  let finalName = name;
  let finalContent = content;

  // If sourcePath is provided, read the file and build JSON content
  if (sourcePath) {
    const fileContent = await readFile(sourcePath, 'utf-8');
    const ext = extname(sourcePath).toLowerCase();
    const language = EXT_TO_LANGUAGE[ext] || 'text';

    if (!finalName) {
      finalName = basename(sourcePath);
    }

    let code = fileContent;
    let lineOffset: number | undefined;

    // Handle line range slicing
    if (startLine !== undefined || endLine !== undefined) {
      const lines = fileContent.split('\n');
      const start = Math.max(1, startLine ?? 1);
      const end = Math.min(lines.length, endLine ?? lines.length);
      code = lines.slice(start - 1, end).join('\n');
      lineOffset = start;
    }

    const snippetData: Record<string, unknown> = {
      language,
      code,
      filePath: sourcePath,
      originalCode: code,
    };

    if (lineOffset !== undefined) {
      snippetData.startLine = startLine;
      snippetData.endLine = endLine;
    }

    finalContent = JSON.stringify(snippetData);
  }

  if (!finalName || finalContent === undefined) {
    throw new Error('Either provide name+content, or sourcePath to auto-load from file');
  }

  const response = await fetch(buildUrl('/api/snippet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: finalName, content: finalContent }),
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

export async function handleApplySnippet(
  project: string,
  session: string,
  id: string,
): Promise<ApplySnippetResult> {
  // Get the snippet
  const snippet = await handleGetSnippet(project, session, id);

  // Parse JSON content to extract code and filePath
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(snippet.content);
  } catch {
    throw new Error('Snippet content is not valid JSON — cannot determine filePath');
  }

  const filePath = parsed.filePath as string;
  const code = parsed.code as string;
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Snippet has no filePath — cannot apply to disk');
  }
  if (code === undefined || typeof code !== 'string') {
    throw new Error('Snippet has no code field');
  }

  const startLine = parsed.startLine as number | undefined;
  const endLine = parsed.endLine as number | undefined;

  // If line range, splice into the original file
  if (startLine !== undefined && endLine !== undefined) {
    const originalFile = await readFile(filePath, 'utf-8');
    const lines = originalFile.split('\n');
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, endLine);
    const newLines = code.split('\n');

    // Replace the range
    lines.splice(start - 1, end - start + 1, ...newLines);
    await writeFile(filePath, lines.join('\n'));

    return {
      success: true,
      filePath,
      linesWritten: newLines.length,
      range: { startLine: start, endLine: start + newLines.length - 1 },
    };
  }

  // Full file write
  await writeFile(filePath, code);
  const linesWritten = code.split('\n').length;

  return { success: true, filePath, linesWritten };
}
