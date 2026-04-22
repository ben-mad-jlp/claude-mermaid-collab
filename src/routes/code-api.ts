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
import { walkProject } from '../services/source-scanner.js';

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
      const recursive = url.searchParams.get('recursive') === 'true';
      if (recursive) {
        return handleListAllProjectFiles(project);
      }
      const dirPath = url.searchParams.get('path') || undefined;
      return handleListProjectFiles(project, dirPath);
    }

    // GET /file — read raw source file for the code browser
    if (path === '/file' && req.method === 'GET') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        return jsonError('Missing required query parameter: path', 400);
      }
      return handleReadCodeFile(project, filePath);
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

    // POST /record-edit-decision — flat path called by CodeEditor hunk accept/reject
    if (path === '/record-edit-decision' && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      return handleRecordEditDecision(req, project, session);
    }

    // POST /proposed-edit/:id/record-decision — record a client-side edit decision
    if (path.match(/^\/proposed-edit\/[^/]+\/record-decision$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      return handleRecordEditDecision(req, project, session);
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

interface EditDecisionPayload {
  snippetId: string;
  action: 'accepted' | 'rejected';
  scope: 'whole-file' | 'hunk';
  hunkIndex?: number;
  filePath: string;
  proposedBy: string;
  proposedAt: number;
  message?: string;
  linesAdded: number;
  linesRemoved: number;
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

async function handleListAllProjectFiles(project: string): Promise<Response> {
  if (!isAbsolute(project)) {
    return jsonError('project must be an absolute path', 400);
  }
  const projectRoot = resolve(project);
  if (!(await isKnownProject(projectRoot))) {
    return jsonError(`Unknown project: ${projectRoot}`, 400);
  }

  const entries: FileEntry[] = [];
  try {
    for await (const abs of walkProject(projectRoot, {
      respectGitignore: true,
      skipTests: false,
    })) {
      const rel = relative(projectRoot, abs);
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const ext = extname(name);
      entries.push({
        name,
        path: abs,
        relativePath: rel,
        type: 'file',
        ...(ext ? { extension: ext } : {}),
      });
    }
  } catch (err: any) {
    return jsonError(`Failed to walk project: ${err?.message ?? err}`, 500);
  }
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return Response.json({ entries });
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

// ============================================================================
// GET /api/code/file — read raw source contents for the code browser
// ============================================================================

const CODE_FILE_TEXT_CAP_BYTES = 2 * 1024 * 1024; // 2 MB
const CODE_FILE_IMAGE_CAP_BYTES = 1 * 1024 * 1024; // 1 MB

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.md': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'shell',
  '.sql': 'sql',
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function detectLanguageByExt(ext: string): string | null {
  return LANGUAGE_BY_EXT[ext.toLowerCase()] ?? null;
}

async function handleReadCodeFile(project: string, filePath: string): Promise<Response> {
  if (!isAbsolute(project)) {
    return jsonError('project must be an absolute path', 400);
  }
  const projectRoot = resolve(project);
  if (!(await isKnownProject(projectRoot))) {
    return jsonError(`Unknown project: ${projectRoot}`, 400);
  }

  // Resolve filePath against the project root if relative.
  const absTarget = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);

  let realPath: string;
  try {
    realPath = await validatePathUnderRoot(absTarget, projectRoot);
  } catch (err: any) {
    // ENOENT during realpath also lands here; surface as 404 for nicer UX.
    if (err && err.code === 'ENOENT') {
      return jsonError('File not found', 404);
    }
    return jsonError('Path escapes project root', 400);
  }

  let stats;
  try {
    stats = await stat(realPath);
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return jsonError('File not found', 404);
    }
    return jsonError(`Failed to stat file: ${err?.message ?? err}`, 500);
  }

  if (!stats.isFile()) {
    return jsonError('Not a regular file', 400);
  }

  const sizeBytes = stats.size;
  const mtimeMs = stats.mtimeMs;
  const ext = extname(realPath).toLowerCase();

  // Image branch — return as data URL if under cap, otherwise binary placeholder.
  if (ext in IMAGE_MIME_BY_EXT) {
    const mimeType = IMAGE_MIME_BY_EXT[ext];
    if (sizeBytes > CODE_FILE_IMAGE_CAP_BYTES) {
      return Response.json({ kind: 'binary', sizeBytes, mimeType });
    }
    try {
      const buf = await readFile(realPath);
      const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;
      return Response.json({ kind: 'image', sizeBytes, mimeType, dataUrl });
    } catch (err: any) {
      if (err && err.code === 'ENOENT') return jsonError('File not found', 404);
      return jsonError(`Failed to read image: ${err?.message ?? err}`, 500);
    }
  }

  // Binary sniff — scan first 4 KB for NUL bytes.
  let isBinary = false;
  try {
    const { open } = await import('fs/promises');
    const fh = await open(realPath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      if (bytesRead > 0 && buf.subarray(0, bytesRead).indexOf(0x00) !== -1) {
        isBinary = true;
      }
    } finally {
      await fh.close();
    }
  } catch (err: any) {
    if (err && err.code === 'ENOENT') return jsonError('File not found', 404);
    return jsonError(`Failed to probe file: ${err?.message ?? err}`, 500);
  }

  if (isBinary) {
    return Response.json({ kind: 'binary', sizeBytes });
  }

  // Text branch
  const language = detectLanguageByExt(ext);
  if (sizeBytes > CODE_FILE_TEXT_CAP_BYTES) {
    return Response.json({
      kind: 'text',
      content: '',
      language,
      sizeBytes,
      truncated: true,
      mtimeMs,
    });
  }

  try {
    const content = await readFile(realPath, 'utf-8');
    return Response.json({
      kind: 'text',
      content,
      language,
      sizeBytes,
      truncated: false,
      mtimeMs,
    });
  } catch (err: any) {
    if (err && err.code === 'ENOENT') return jsonError('File not found', 404);
    return jsonError(`Failed to read file: ${err?.message ?? err}`, 500);
  }
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

  const decisionInfo = {
    filePath: envelope.filePath ?? id,
    proposedBy: envelope.proposedEdit.proposedBy ?? 'claude',
    proposedAt: envelope.proposedEdit.proposedAt ?? Date.now(),
    message: envelope.proposedEdit.message,
    newCode: envelope.proposedEdit.newCode,
  };

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

  try {
    await appendEditDecision(project, session, {
      snippetId: id,
      action: 'accepted',
      scope: 'whole-file',
      filePath: decisionInfo.filePath,
      proposedBy: decisionInfo.proposedBy,
      proposedAt: decisionInfo.proposedAt,
      message: decisionInfo.message,
      linesAdded: decisionInfo.newCode ? decisionInfo.newCode.split('\n').length : 0,
      linesRemoved: envelope.code ? envelope.code.split('\n').length : 0,
    });
  } catch (e) {
    console.error('[appendEditDecision] failed silently:', e);
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

  const decisionInfo = {
    filePath: envelope.filePath ?? id,
    proposedBy: envelope.proposedEdit.proposedBy ?? 'claude',
    proposedAt: envelope.proposedEdit.proposedAt ?? Date.now(),
    message: envelope.proposedEdit.message,
    newCode: envelope.proposedEdit.newCode,
    originalCode: envelope.code,
  };

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

  try {
    await appendEditDecision(project, session, {
      snippetId: id,
      action: 'rejected',
      scope: 'whole-file',
      filePath: decisionInfo.filePath,
      proposedBy: decisionInfo.proposedBy,
      proposedAt: decisionInfo.proposedAt,
      message: decisionInfo.message,
      linesAdded: decisionInfo.newCode ? decisionInfo.newCode.split('\n').length : 0,
      linesRemoved: decisionInfo.originalCode ? decisionInfo.originalCode.split('\n').length : 0,
    });
  } catch (e) {
    console.error('[appendEditDecision] failed silently:', e);
  }

  return Response.json({ success: true });
}

async function appendEditDecision(
  project: string,
  session: string,
  decision: EditDecisionPayload,
): Promise<void> {
  try {
    const docsDir = sessionRegistry.resolvePath(project, session, 'documents');
    const decisionFilePath = join(docsDir, 'edit-decisions.md');

    let existing = '';
    try {
      existing = await readFile(decisionFilePath, 'utf-8');
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
      // File doesn't exist yet — start fresh
      existing = '# Edit Decisions\n\nA log of accepted and rejected proposed edits.\n';
    }

    const decisionSection = `\n## Decision ${new Date().toISOString()}\n\n- **file**: \`${decision.filePath}\`\n- **snippetId**: \`${decision.snippetId}\`\n- **action**: ${decision.action}\n- **scope**: ${decision.scope}\n${decision.hunkIndex !== undefined ? `- **hunkIndex**: ${decision.hunkIndex}\n` : ''}- **proposedBy**: ${decision.proposedBy}\n- **decidedBy**: user\n- **proposedAt**: ${new Date(decision.proposedAt).toISOString()}\n- **decidedAt**: ${new Date().toISOString()}\n${decision.message ? `- **message**: "${decision.message}"\n` : ''}- **linesAdded**: ${decision.linesAdded}\n- **linesRemoved**: ${decision.linesRemoved}\n\n---\n`;

    await writeFile(decisionFilePath, existing + decisionSection, 'utf-8');
    console.log('[appendEditDecision] Decision logged:', decision.action, decision.filePath);
  } catch (e) {
    console.error('[appendEditDecision] Error:', e);
  }
}

async function handleRecordEditDecision(
  req: Request,
  project: string,
  session: string,
): Promise<Response> {
  let body: EditDecisionPayload;
  try {
    body = (await req.json()) as EditDecisionPayload;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { snippetId, action, scope, filePath } = body;
  if (!snippetId || !action || !scope || !filePath) {
    return jsonError('Missing required fields: snippetId, action, scope, filePath', 400);
  }

  await appendEditDecision(project, session, body);

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
