/**
 * MCP Snippet Tools
 *
 * CRUD operations for code snippets stored as .snippet files in session folders.
 */

import { readFile, writeFile } from 'fs/promises';
import { extname, basename } from 'path';

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
    content: { type: 'string', description: 'Snippet content (JSON or raw code). Not required if sourcePath is provided.' },
    sourcePath: { type: 'string', description: 'Absolute path to source file. Reads the file, auto-detects language, and sets originalCode.' },
    startAt: { type: 'string', description: 'Anchor string — extract starts at the line containing this text (inclusive). Matched via trimmed substring.' },
    endAt: { type: 'string', description: 'Anchor string — extract ends at the line containing this text (inclusive). Matched via trimmed substring.' },
    maxLines: { type: 'number', description: 'Max lines to extract (default 500). Error if range exceeds this.' },
    groupId: { type: 'string', description: 'Group ID to link related snippets together. Snippets with the same groupId display as tabs in the UI.' },
    groupName: { type: 'string', description: 'Display name for the snippet group shown in the sidebar (e.g. "Auth Feature"). All snippets in a group should use the same groupName.' },
  },
  required: ['project'],
};

export const updateSnippetSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID' },
    content: { type: 'string', description: 'Updated snippet content. Can be raw code — language, groupId, groupName, and other metadata from the existing JSON envelope are preserved automatically.' },
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

// ============= Anchor Helpers =============

export function findAnchorLine(lines: string[], anchor: string, label: string, filePath: string): number {
  const trimmedAnchor = anchor.trim();
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().includes(trimmedAnchor)) {
      matches.push(i);
    }
  }
  if (matches.length === 0) {
    throw new Error(`${label} anchor not found in ${filePath}: "${trimmedAnchor}"`);
  }
  if (matches.length > 1) {
    const context = matches.map(idx => {
      const before = idx > 0 ? `  ${idx}: ${lines[idx - 1]}` : '';
      const line = `  ${idx + 1}: ${lines[idx]}`;
      const after = idx < lines.length - 1 ? `  ${idx + 2}: ${lines[idx + 1]}` : '';
      return [before, line, after].filter(Boolean).join('\n');
    }).join('\n---\n');
    throw new Error(`${label} anchor "${trimmedAnchor}" matched ${matches.length} lines in ${filePath}:\n${context}`);
  }
  return matches[0];
}

export function extractWithAnchors(fileContent: string, filePath: string, startAt?: string, endAt?: string, maxLines: number = 500): string {
  if (!filePath) throw new Error('filePath is required for anchor extraction');
  if (!fileContent) throw new Error('fileContent is empty — nothing to extract');
  const normalized = fileContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 1 && (startAt || endAt)) {
    throw new Error(`File appears to be minified (1 line) — anchor extraction is not supported: ${filePath}`);
  }

  const startIndex = startAt ? findAnchorLine(lines, startAt, 'startAt', filePath) : 0;
  const endIndex = endAt ? findAnchorLine(lines, endAt, 'endAt', filePath) : lines.length - 1;

  if (endIndex < startIndex) {
    throw new Error(`endAt anchor appears before startAt anchor (line ${endIndex + 1} < ${startIndex + 1}) in ${filePath}`);
  }

  const rangeSize = endIndex - startIndex + 1;
  if (rangeSize > maxLines) {
    throw new Error(`Anchor range is ${rangeSize} lines, exceeding maxLines limit of ${maxLines} in ${filePath}`);
  }

  return lines.slice(startIndex, endIndex + 1).join('\n');
}

// ============= Handlers =============

export async function handleCreateSnippet(
  project: string,
  session: string,
  name?: string,
  content?: string,
  sourcePath?: string,
  startLine?: number,
  endLine?: number,
  groupId?: string,
  groupName?: string,
  startAt?: string,
  endAt?: string,
  maxLines?: number,
): Promise<CreateSnippetResult> {
  let finalName = name;
  let finalContent = content;

  // Deprecation warning for startLine/endLine
  if (startLine !== undefined || endLine !== undefined) {
    console.warn('[snippet] startLine/endLine are deprecated — use startAt/endAt anchors instead');
  }

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

    // Anchor-based extraction takes priority over line-based
    if (startAt !== undefined || endAt !== undefined) {
      code = extractWithAnchors(fileContent, sourcePath, startAt, endAt, maxLines);
    } else if (startLine !== undefined || endLine !== undefined) {
      // Legacy line-based slicing (deprecated)
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
      ...(groupId && { groupId }),
      ...(groupName && { groupName }),
    };

    // Store anchor info
    if (startAt !== undefined) snippetData.startAt = startAt;
    if (endAt !== undefined) snippetData.endAt = endAt;

    if (lineOffset !== undefined) {
      snippetData.startLine = startLine;
      snippetData.endLine = endLine;
    }

    finalContent = JSON.stringify(snippetData);
  }

  if (!finalName || finalContent === undefined) {
    throw new Error('Either provide name+content, or sourcePath to auto-load from file');
  }

  // Inject groupId/groupName into JSON content if provided and content is JSON
  if (groupId && finalContent && !sourcePath) {
    try {
      const parsed = JSON.parse(finalContent);
      parsed.groupId = groupId;
      if (groupName) parsed.groupName = groupName;
      finalContent = JSON.stringify(parsed);
    } catch {
      // Content isn't JSON — wrap it
      finalContent = JSON.stringify({ code: finalContent, groupId, ...(groupName && { groupName }) });
    }
  }

  // If content is still raw code (not JSON), wrap in envelope with language detection
  if (finalContent && !sourcePath) {
    let alreadyJson = false;
    try { JSON.parse(finalContent); alreadyJson = true; } catch {}
    if (!alreadyJson) {
      const ext = finalName ? extname(finalName).toLowerCase() : '';
      const language = EXT_TO_LANGUAGE[ext] || 'text';
      finalContent = JSON.stringify({ code: finalContent, language, originalCode: finalContent });
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
  content: string
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
            finalContent = JSON.stringify(existing);
          }
        } else if (incomingParsed && typeof incomingParsed === 'object') {
          // JSON content — merge: preserve existing fields not in incoming
          const merged = { ...existing, ...incomingParsed };
          if (typeof merged.code === 'string') merged.originalCode = merged.code;
          finalContent = JSON.stringify(merged);
        }
      }
    } catch {
      // existing content isn't JSON — wrap incoming content in envelope with language detection
      if (isRawCode) {
        const name = snippetData?.name || '';
        const ext = extname(name).toLowerCase();
        const language = EXT_TO_LANGUAGE[ext] || 'text';
        finalContent = JSON.stringify({ code: content, language, originalCode: content });
      }
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
