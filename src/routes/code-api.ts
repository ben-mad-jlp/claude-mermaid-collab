/**
 * Code API Routes
 *
 * REST API endpoints for linked code file operations:
 * listing project files, pushing snippets to disk, syncing from disk, and computing diffs.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'path';
import { createPatch } from 'diff';
import { sessionRegistry } from '../services/session-registry.js';
import { projectRegistry } from '../services/project-registry.js';
import { SnippetManager } from '../services/snippet-manager.js';
import { validatePathUnderRoot } from '../utils/path-security.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { getPseudoDb } from '../services/pseudo-db.js';

// Directories and files to exclude from file listings
const EXCLUDED_NAMES = new Set([
  'node_modules',
  '.git',
  '.collab',
  '.DS_Store',
  '.env',
  '.worktrees',
]);

/**
 * Handle Code API requests
 */
export async function handleCodeAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/code', '');
  const project = url.searchParams.get('project');
  const session = url.searchParams.get('session');

  if (!project) {
    return jsonError('Missing required query parameter: project', 400);
  }

  try {
    // GET /files — list project files
    if (path === '/files' && req.method === 'GET') {
      const dirPath = url.searchParams.get('path') || undefined;
      return handleListProjectFiles(project, dirPath);
    }

    // POST /push/:id — push snippet code to linked file
    if (path.match(/^\/push\/[^/]+$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/').pop()!);
      return handlePushToFile(project, session, id);
    }

    // POST /sync/:id — sync snippet from disk
    if (path.match(/^\/sync\/[^/]+$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/').pop()!);
      return handleSyncFromDisk(project, session, id);
    }

    // POST /proposed-edit/:id/accept — accept a pending proposed edit
    if (path.match(/^\/proposed-edit\/[^/]+\/accept$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/')[2]);
      return handleAcceptProposedEdit(project, session, id);
    }

    // POST /proposed-edit/:id/reject — reject a pending proposed edit
    if (path.match(/^\/proposed-edit\/[^/]+\/reject$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/')[2]);
      return handleRejectProposedEdit(project, session, id);
    }

    // POST /proposed-edit/:id — create/replace a proposed edit
    if (path.match(/^\/proposed-edit\/[^/]+$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/').pop()!);
      const body = await req.json() as { newCode?: unknown; message?: unknown };
      return handleCreateProposedEdit(project, session, id, body);
    }

    // GET /diff/:id — compute diffs for a linked snippet
    if (path.match(/^\/diff\/[^/]+$/) && req.method === 'GET') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/').pop()!);
      return handleGetDiff(project, session, id);
    }

    // POST /search — cross-artifact search over pseudo FTS + linked snippet content
    if (path === '/search' && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const body = await req.json().catch(() => ({})) as { query?: unknown; limit?: unknown };
      return handleCodeSearch(project, session, body);
    }

    return jsonError('Not found', 404);
  } catch (error) {
    console.error('[Code API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonError(message, 500);
  }
}

// ============================================================================
// Handlers
// ============================================================================

interface FileEntry {
  name: string;
  path: string;          // absolute path (for display/tooltips and onSelect callback)
  relativePath: string;  // relative to project root — use this as tree key + subsequent request param
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

/**
 * Check whether a given absolute path matches a known project root.
 * A project is "known" if it appears in projects.json OR if it's the project
 * of any registered session. Both sides are normalized via resolve() before
 * comparison to avoid false negatives from trailing slashes or relative paths.
 */
async function isKnownProject(projectPath: string): Promise<boolean> {
  const resolvedCandidate = resolve(projectPath);

  // Check projects.json first
  try {
    const data = await projectRegistry.load();
    for (const p of data.projects) {
      if (resolve(p.path) === resolvedCandidate) return true;
    }
  } catch {
    // fall through to session registry
  }

  // Fallback: check sessions.json (any session whose project field matches)
  try {
    const sessionsData = await sessionRegistry.load();
    for (const s of sessionsData.sessions) {
      if (resolve(s.project) === resolvedCandidate) return true;
    }
  } catch {
    // corrupt registry or other issue — treat as unknown
  }

  return false;
}

interface CodeSearchResult {
  kind: 'pseudo' | 'code';
  filePath: string;
  methodName?: string;
  line?: number;
  snippet: string;
  snippetId?: string;
}

interface CodeSearchResponse {
  results: CodeSearchResult[];
  truncated: boolean;
}

async function handleListProjectFiles(project: string, dirPath?: string): Promise<Response> {
  // 1. Resolve project to canonical absolute path.
  if (!isAbsolute(project)) {
    return jsonError('project must be an absolute path', 400);
  }
  const projectRoot = resolve(project);

  // 2. Validate project is a known/registered project.
  if (!(await isKnownProject(projectRoot))) {
    return jsonError(`Unknown project: ${projectRoot}`, 400);
  }

  // 3. Normalize dirPath to be relative to the project root.
  let relativeDirPath = '';
  if (dirPath && dirPath.length > 0) {
    if (isAbsolute(dirPath)) {
      const resolvedDirPath = resolve(dirPath);
      if (resolvedDirPath === projectRoot) {
        relativeDirPath = '';
      } else if (resolvedDirPath.startsWith(projectRoot + '/')) {
        relativeDirPath = resolvedDirPath.slice(projectRoot.length + 1);
      } else {
        return jsonError('dirPath escapes project root', 400);
      }
    } else {
      relativeDirPath = dirPath;
    }
  }

  // 4. Resolve the target directory.
  const targetDir = relativeDirPath
    ? resolve(projectRoot, relativeDirPath)
    : projectRoot;

  // 5. Second-layer guard: validatePathUnderRoot (handles .. segments + symlinks).
  try {
    await validatePathUnderRoot(targetDir, projectRoot);
  } catch {
    return jsonError('dirPath escapes project root', 400);
  }

  let dirEntries;
  try {
    dirEntries = await readdir(targetDir, { withFileTypes: true });
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return jsonError(`Directory not found: ${relativeDirPath || '.'}`, 404);
    }
    throw err;
  }

  const entries: FileEntry[] = [];
  for (const entry of dirEntries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const entryPath = join(targetDir, entry.name);
    const isDir = entry.isDirectory();

    const fileEntry: FileEntry = {
      name: entry.name,
      path: entryPath,
      relativePath: relative(projectRoot, entryPath),
      type: isDir ? 'directory' : 'file',
    };

    if (!isDir) {
      try {
        const stats = await stat(entryPath);
        fileEntry.size = stats.size;
      } catch {
        // Skip size if stat fails
      }
      const ext = extname(entry.name);
      if (ext) {
        fileEntry.extension = ext;
      }
    }

    entries.push(fileEntry);
  }

  // Sort: directories first, then alphabetical within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return Response.json({ entries });
}

async function handlePushToFile(project: string, session: string, id: string): Promise<Response> {
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  if (!envelope.filePath) {
    return jsonError('Snippet has no filePath', 400);
  }

  // Validate the file path is under the project root
  await validatePathUnderRoot(envelope.filePath, project);

  // Write the code to disk
  const code = envelope.code ?? '';
  await writeFile(envelope.filePath, code, 'utf-8');
  const bytesWritten = Buffer.byteLength(code, 'utf-8');

  // Update envelope: mark as clean, record push time
  envelope.originalCode = code;
  envelope.diskCode = code;
  envelope.dirty = false;
  envelope.lastPushedAt = Date.now();

  // Save updated snippet
  const updatedContent = JSON.stringify(envelope, null, 2);
  await snippetManager.saveSnippet(id, updatedContent);

  // Broadcast snippet_updated
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updatedSnippet = await snippetManager.getSnippet(id);
    if (updatedSnippet) {
      wsHandler.broadcast({
        type: 'snippet_updated',
        id,
        content: updatedSnippet.content,
        lastModified: updatedSnippet.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, filePath: envelope.filePath, bytesWritten });
}

async function handleCreateProposedEdit(
  project: string,
  session: string,
  id: string,
  body: { newCode?: unknown; message?: unknown },
): Promise<Response> {
  if (typeof body?.newCode !== 'string') {
    return jsonError('body.newCode must be a string', 400);
  }

  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  // Noop short-circuit: proposed content matches current code exactly.
  if (body.newCode === (envelope.code ?? '')) {
    return Response.json({
      success: true,
      id,
      hasProposedEdit: !!envelope.proposedEdit,
      noop: true,
    });
  }

  // Replace any existing proposal silently.
  envelope.proposedEdit = {
    newCode: body.newCode,
    message: typeof body.message === 'string' ? body.message : undefined,
    proposedAt: Date.now(),
    proposedBy: 'claude',
  };

  const updatedContent = JSON.stringify(envelope, null, 2);
  await snippetManager.saveSnippet(id, updatedContent);

  // Broadcast snippet_updated
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updatedSnippet = await snippetManager.getSnippet(id);
    if (updatedSnippet) {
      wsHandler.broadcast({
        type: 'snippet_updated',
        id,
        content: updatedSnippet.content,
        lastModified: updatedSnippet.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, id, hasProposedEdit: true });
}

async function handleAcceptProposedEdit(project: string, session: string, id: string): Promise<Response> {
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  if (!envelope.proposedEdit) {
    return jsonError('No proposed edit to accept', 400);
  }

  envelope.code = envelope.proposedEdit.newCode;
  envelope.dirty = envelope.code !== (envelope.originalCode ?? '');
  delete envelope.proposedEdit;

  const updatedContent = JSON.stringify(envelope, null, 2);
  await snippetManager.saveSnippet(id, updatedContent);

  // Broadcast snippet_updated
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updatedSnippet = await snippetManager.getSnippet(id);
    if (updatedSnippet) {
      wsHandler.broadcast({
        type: 'snippet_updated',
        id,
        content: updatedSnippet.content,
        lastModified: updatedSnippet.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, dirty: envelope.dirty });
}

async function handleRejectProposedEdit(project: string, session: string, id: string): Promise<Response> {
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  // Idempotent: no proposal pending → 200 with noop.
  if (!envelope.proposedEdit) {
    return Response.json({ success: true, noop: true });
  }

  delete envelope.proposedEdit;

  const updatedContent = JSON.stringify(envelope, null, 2);
  await snippetManager.saveSnippet(id, updatedContent);

  // Broadcast snippet_updated
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updatedSnippet = await snippetManager.getSnippet(id);
    if (updatedSnippet) {
      wsHandler.broadcast({
        type: 'snippet_updated',
        id,
        content: updatedSnippet.content,
        lastModified: updatedSnippet.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true });
}

async function handleSyncFromDisk(project: string, session: string, id: string): Promise<Response> {
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  if (!envelope.filePath) {
    return jsonError('Snippet has no filePath', 400);
  }

  // Validate the file path is under the project root
  await validatePathUnderRoot(envelope.filePath, project);

  // Read file from disk (handle deleted files)
  let diskContent: string | null = null;
  let fileDeleted = false;
  try {
    diskContent = await readFile(envelope.filePath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      fileDeleted = true;
    } else {
      throw err;
    }
  }

  if (fileDeleted) {
    return Response.json({
      success: true,
      diskChanged: true,
      hasLocalEdits: false,
      conflict: false,
      fileDeleted: true,
    });
  }

  // Compare disk content vs last known disk content
  const diskChanged = diskContent !== (envelope.diskCode ?? '');
  // Compare local code vs original code
  const hasLocalEdits = (envelope.code ?? '') !== (envelope.originalCode ?? '');
  const conflict = diskChanged && hasLocalEdits;

  // Update diskCode and sync timestamp
  envelope.diskCode = diskContent;
  envelope.lastSyncedAt = Date.now();

  // Auto-sync if disk changed and no local edits
  if (diskChanged && !hasLocalEdits) {
    envelope.code = diskContent;
    envelope.originalCode = diskContent;
  }

  // Save updated snippet
  const updatedContent = JSON.stringify(envelope, null, 2);
  await snippetManager.saveSnippet(id, updatedContent);

  // Broadcast snippet_updated
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updatedSnippet = await snippetManager.getSnippet(id);
    if (updatedSnippet) {
      wsHandler.broadcast({
        type: 'snippet_updated',
        id,
        content: updatedSnippet.content,
        lastModified: updatedSnippet.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({
    success: true,
    diskChanged,
    hasLocalEdits,
    conflict,
  });
}

async function handleGetDiff(project: string, session: string, id: string): Promise<Response> {
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const snippetManager = new SnippetManager(snippetsDir);
  await snippetManager.initialize();

  const snippet = await snippetManager.getSnippet(id);
  if (!snippet) {
    return jsonError(`Snippet "${id}" not found`, 404);
  }

  const envelope = JSON.parse(snippet.content);

  if (!envelope.linked) {
    return jsonError('Snippet is not linked to a file', 400);
  }

  const code = envelope.code ?? '';
  const originalCode = envelope.originalCode ?? '';
  const diskCode = envelope.diskCode ?? '';
  const fileName = envelope.filePath ?? id;

  // Compute unified diffs
  const localVsOriginal = createPatch(
    fileName,
    originalCode,
    code,
    'original',
    'local'
  );

  const localVsDisk = createPatch(
    fileName,
    diskCode,
    code,
    'disk',
    'local'
  );

  return Response.json({ localVsOriginal, localVsDisk });
}

async function handleCodeSearch(
  project: string,
  session: string,
  body: { query?: unknown; limit?: unknown },
): Promise<Response> {
  if (typeof body.query !== 'string' || body.query.trim() === '') {
    return jsonError('body.query must be a non-empty string', 400);
  }

  const truncatedQuery = body.query.trim().slice(0, 200);
  const limit = Math.min(
    typeof body.limit === 'number' && body.limit > 0 ? body.limit : 50,
    100,
  );

  const results: CodeSearchResult[] = [];
  let totalHits = 0;

  // 1. Pseudo fan-out — FTS with per-row location lookup
  try {
    const db = getPseudoDb(project);
    const ftsHits = db.search(truncatedQuery);
    for (const hit of ftsHits) {
      totalHits++;
      if (results.length < limit) {
        const loc = db.getMethodLocation(hit.filePath, hit.methodName);
        results.push({
          kind: 'pseudo',
          filePath: loc?.sourceFilePath ?? hit.filePath,
          methodName: hit.methodName,
          line: loc?.sourceLine ?? undefined,
          snippet: escapePseudoSnippet(hit.snippet), // already has <mark> from FTS snippet()
        });
      }
    }
  } catch {
    // Pseudo FTS errors (e.g. punctuation-only queries) → skip pseudo branch
  }

  // 2. Code fan-out — grep over linked snippet content
  try {
    const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
    const snippetManager = new SnippetManager(snippetsDir);
    await snippetManager.initialize();
    const snippets = await snippetManager.listSnippets();

    const loweredQuery = truncatedQuery.toLowerCase();

    for (const snippet of snippets) {
      if (results.length >= limit + 1) break; // already over cap; bail early
      let envelope: any;
      try {
        envelope = JSON.parse(snippet.content);
      } catch {
        continue;
      }
      if (envelope.linked !== true || typeof envelope.code !== 'string') continue;

      const code = envelope.code;
      const loweredCode = code.toLowerCase();

      let searchFrom = 0;
      while (true) {
        const matchIdx = loweredCode.indexOf(loweredQuery, searchFrom);
        if (matchIdx < 0) break;

        totalHits++;
        if (results.length < limit) {
          const ctxStart = Math.max(0, matchIdx - 40);
          const ctxEnd = Math.min(code.length, matchIdx + truncatedQuery.length + 40);
          const before = code.substring(ctxStart, matchIdx);
          const matched = code.substring(matchIdx, matchIdx + truncatedQuery.length);
          const after = code.substring(matchIdx + truncatedQuery.length, ctxEnd);
          const excerpt = htmlEscape(before) + '<mark>' + htmlEscape(matched) + '</mark>' + htmlEscape(after);

          // Compute 1-based line number
          const linesBefore = (code.substring(0, matchIdx).match(/\n/g) || []).length;
          const line = linesBefore + 1;

          results.push({
            kind: 'code',
            filePath: typeof envelope.filePath === 'string' ? envelope.filePath : '',
            line,
            snippet: excerpt,
            snippetId: snippet.id,
          });
        }

        searchFrom = matchIdx + truncatedQuery.length;
      }
    }
  } catch (err) {
    console.error('[Code Search] snippet grep error:', err);
  }

  const truncated = totalHits > results.length;
  return Response.json({ results, truncated });
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape the snippet's embedded <mark>...</mark> safely:
// 1. Replace the literal <mark> tokens with sentinels
// 2. HTML-escape the entire string (which is safe because sentinels are pure ASCII)
// 3. Swap sentinels back to real <mark> tags
function escapePseudoSnippet(snippet: string): string {
  const OPEN_SENTINEL = '\u0001MARK_OPEN\u0001';
  const CLOSE_SENTINEL = '\u0001MARK_CLOSE\u0001';
  return snippet
    .replace(/<mark>/g, OPEN_SENTINEL)
    .replace(/<\/mark>/g, CLOSE_SENTINEL)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(new RegExp(OPEN_SENTINEL, 'g'), '<mark>')
    .replace(new RegExp(CLOSE_SENTINEL, 'g'), '</mark>');
}

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
