/**
 * Code File API Client - HTTP fetch for the core /api/code/file route.
 * Used by the file viewer (CodeFileView) and GlobalSearch.
 */

const API_BASE = ''; // Use relative URLs (same host)

export type CodeFileResponse =
  | { kind: 'text'; content: string; language: string | null; sizeBytes: number; truncated: boolean; mtimeMs: number }
  | { kind: 'image'; sizeBytes: number; mimeType: string; dataUrl: string }
  | { kind: 'binary'; sizeBytes: number };

export class CodeFileNotFoundError extends Error {
  constructor(message = 'File not found') {
    super(message);
    this.name = 'CodeFileNotFoundError';
  }
}
export class CodeFilePathError extends Error {
  constructor(message = 'Invalid path') {
    super(message);
    this.name = 'CodeFilePathError';
  }
}

export async function fetchCodeFile(project: string, path: string, opts?: { signal?: AbortSignal; allowLarge?: boolean }): Promise<CodeFileResponse> {
  let url = `${API_BASE}/api/code/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;
  if (opts?.allowLarge) url += '&allowLarge=1';
  const response = await fetch(url, { signal: opts?.signal });
  if (response.status === 404) throw new CodeFileNotFoundError();
  if (response.status === 400) throw new CodeFilePathError();
  if (!response.ok) throw new Error(`Failed to fetch code file: ${response.statusText}`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || (data.kind !== 'text' && data.kind !== 'image' && data.kind !== 'binary')) {
    throw new Error('Invalid code file response shape');
  }
  if (data.kind === 'text') {
    if (typeof data.content !== 'string' || typeof data.sizeBytes !== 'number' || typeof data.truncated !== 'boolean' || typeof data.mtimeMs !== 'number') {
      throw new Error('Invalid code file text response');
    }
  } else if (data.kind === 'image') {
    if (typeof data.mimeType !== 'string' || typeof data.dataUrl !== 'string' || typeof data.sizeBytes !== 'number') {
      throw new Error('Invalid code file image response');
    }
  } else if (data.kind === 'binary') {
    if (typeof data.sizeBytes !== 'number') {
      throw new Error('Invalid code file binary response');
    }
  }
  return data as CodeFileResponse;
}
