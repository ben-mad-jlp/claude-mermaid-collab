/**
 * MCP Snippet Tools
 *
 * CRUD operations for code snippets stored as .snippet files in session folders.
 */

import { extname } from 'path';

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
  language?: string;
  filePath?: string;
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
  content: string;
  format: string;
}


// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name.' },
};

export const createSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    name: { type: 'string', description: 'Snippet name. Include a file extension to enable syntax highlighting (e.g. "UpdatePackageTypeAsync.cs", "auth.ts", "config.py"). Without an extension, language defaults to plain text.' },
    content: { type: 'string', description: 'Snippet content (JSON or raw code).' },
    tags: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } }, required: ['type', 'value'] }, description: 'Optional tags to associate with the snippet.' },
  },
  required: ['project'],
};

export const updateSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID' },
    content: { type: 'string', description: 'Updated snippet content. Can be raw code — language and other metadata from the existing JSON envelope are preserved automatically.' },
    tags: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } }, required: ['type', 'value'] }, description: 'Optional tags to associate with the snippet.' },
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
  tags?: Array<{ type: string; value: string }>,
): Promise<CreateSnippetResult> {
  let finalName = name;
  let finalContent = content;

  if (!finalName || finalContent === undefined) {
    throw new Error('name and content are required');
  }

  // If content is raw code (not JSON), wrap in envelope with language detection
  let alreadyJson = false;
  try { JSON.parse(finalContent); alreadyJson = true; } catch {}
  if (!alreadyJson) {
    const ext = finalName ? extname(finalName).toLowerCase() : '';
    const language = EXT_TO_LANGUAGE[ext] || 'text';
    finalContent = JSON.stringify({ code: finalContent, language, originalCode: finalContent, ...(tags && tags.length > 0 && { tags }) });
  } else if (tags && tags.length > 0) {
    // Merge tags into existing JSON envelope
    try {
      const parsed = JSON.parse(finalContent);
      parsed.tags = tags;
      finalContent = JSON.stringify(parsed);
    } catch {
      // leave as-is
    }
  }

  const response = await fetch(buildUrl('/api/snippet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: finalName, content: finalContent }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to create snippet: ${error.error || response.statusText}`);
  }

  const data = await response.json() as any;
  return { success: true, id: data.id };
}

export async function handleUpdateSnippet(
  project: string,
  session: string,
  id: string,
  content: string,
  tags?: Array<{ type: string; value: string }>,
): Promise<UpdateSnippetResult> {
  // Preserve the existing JSON envelope (groupId, groupName, filePath, etc.)
  // by merging into the existing object rather than replacing it entirely.
  let finalContent = content;
  let isRawCode = false;
  let incomingParsed: Record<string, unknown> | null = null;
  try {
    incomingParsed = JSON.parse(content);
  } catch {
    isRawCode = true;
  }

  const getResponse = await fetch(buildUrl(`/api/snippet/${id}`, project, session));
  if (getResponse.ok) {
    const snippetData = await getResponse.json() as any;
    try {
      const existing = JSON.parse(snippetData.content);
      if (typeof existing === 'object' && existing !== null) {
        if (isRawCode) {
          // Raw code — merge into existing envelope
          if (typeof existing.code === 'string') {
            existing.code = content;
            existing.originalCode = content;
            if (tags && tags.length > 0) existing.tags = tags;
            finalContent = JSON.stringify(existing);
          }
        } else if (incomingParsed && typeof incomingParsed === 'object') {
          // JSON content — merge: preserve existing fields not in incoming
          const merged = { ...existing, ...incomingParsed };
          if (typeof merged.code === 'string') merged.originalCode = merged.code;
          if (tags && tags.length > 0) merged.tags = tags;
          finalContent = JSON.stringify(merged);
        }
      }
    } catch {
      // existing content isn't JSON — wrap incoming content in envelope with language detection
      if (isRawCode) {
        const name = snippetData?.name || '';
        const ext = extname(name).toLowerCase();
        const language = EXT_TO_LANGUAGE[ext] || 'text';
        finalContent = JSON.stringify({ code: content, language, originalCode: content, ...(tags && tags.length > 0 && { tags }) });
      }
    }
  }

  // If tags provided but we didn't get to merge them above (e.g. getResponse failed), inject into finalContent
  if (tags && tags.length > 0) {
    try {
      const parsed = JSON.parse(finalContent);
      if (typeof parsed === 'object' && parsed !== null && !parsed.tags) {
        parsed.tags = tags;
        finalContent = JSON.stringify(parsed);
      }
    } catch {
      // leave as-is
    }
  }

  const response = await fetch(buildUrl(`/api/snippet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: finalContent }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
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

  const data = await response.json() as any;

  // Parse JSON envelope to extract code, metadata, and annotations
  let code: string = data.content;
  let language: string | undefined;
  let filePath: string | undefined;
  let annotations: Array<{ startLine: number; endLine: number; text: string }> = [];

  try {
    const parsed = JSON.parse(data.content);
    if (typeof parsed.code === 'string') {
      code = parsed.code;
      if (typeof parsed.language === 'string') language = parsed.language;
      if (typeof parsed.filePath === 'string') filePath = parsed.filePath;
      if (Array.isArray(parsed.annotations)) annotations = parsed.annotations;
    }
  } catch {
    // plain-text snippet — no envelope to parse
  }

  // Inject annotations as comment lines above their annotated ranges.
  // Process in descending order so earlier insertions don't shift later line numbers.
  if (annotations.length > 0) {
    const lines = code.split('\n');
    const sorted = [...annotations].sort((a, b) => b.startLine - a.startLine);
    for (const ann of sorted) {
      const insertAt = ann.startLine - 1; // convert to 0-indexed
      if (insertAt >= 0 && insertAt <= lines.length) {
        lines.splice(insertAt, 0, `/* [NOTE] ${ann.text} */`);
      }
    }
    code = lines.join('\n');
  }

  return {
    id: data.id,
    name: data.name || data.id,
    content: code,
    language,
    filePath,
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

  const data = await response.json() as any;
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
    const error = await response.json() as any;
    throw new Error(`Failed to delete snippet: ${error.error || response.statusText}`);
  }

  return { success: true };
}

export async function handleExportSnippet(
  project: string,
  session: string,
  id: string,
  format: string = 'text',
): Promise<ExportSnippetResult> {
  // Get the snippet first
  const snippet = await handleGetSnippet(project, session, id);

  let content: string;

  if (format === 'json') {
    content = JSON.stringify({
      id: snippet.id,
      name: snippet.name,
      content: snippet.content,
      lastModified: snippet.lastModified,
    }, null, 2);
  } else {
    content = snippet.content;
  }

  return { success: true, content, format: format === 'json' ? 'json' : 'text' };
}
