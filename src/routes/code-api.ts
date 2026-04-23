/**
 * Code API Routes
 *
 * REST API endpoints for linked code file operations:
 * listing project files, pushing snippets to disk, syncing from disk, and computing diffs.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { basename, join, extname, resolve, relative, isAbsolute } from 'path';
import { createHash } from 'crypto';
import { validatePathUnderRoot, isBinaryFile } from '../utils/path-security.js';
import { createPatch } from 'diff';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
import { sessionRegistry } from '../services/session-registry.js';
import { projectRegistry } from '../services/project-registry.js';
import { CodeFileManager } from '../services/code-file-manager.js';
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
      const comment = url.searchParams.get('comment') ?? undefined;
      return handleAcceptProposedEdit(project, session, id, comment);
    }

    // POST /proposed-edit/:id/reject — reject a pending proposed edit
    if (path.match(/^\/proposed-edit\/[^/]+\/reject$/) && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const id = decodeURIComponent(path.split('/')[2]);
      const comment = url.searchParams.get('comment') ?? undefined;
      return handleRejectProposedEdit(project, session, id, comment);
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

    // POST /create — create a linked snippet for a file path (pin/promote flow)
    if (path === '/create' && req.method === 'POST') {
      if (!session) {
        return jsonError('Missing required query parameter: session', 400);
      }
      const body = await req.json().catch(() => ({})) as { filePath?: unknown; name?: unknown };
      return handleCreateCodeArtifact(project, session, body);
    }

    // GET /exists — check whether a path exists under the project root
    if (path === '/exists' && req.method === 'GET') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return jsonError('Missing required query parameter: path', 400);
      return handlePathExists(project, filePath);
    }

    // GET /list — list code files for a session
    if (path === '/list' && req.method === 'GET') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      return handleListCodeFiles(project, session);
    }

    // PATCH /update/:id — update code file content
    if (path.match(/^\/update\/[^/]+$/) && req.method === 'PATCH') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      const id = decodeURIComponent(path.split('/').pop()!);
      const body = await req.json().catch(() => ({})) as { content?: unknown };
      return handleUpdateCodeContent(project, session, id, body);
    }

    // GET /get/:id — get code file record
    if (path.match(/^\/get\/[^/]+$/) && req.method === 'GET') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      const id = decodeURIComponent(path.split('/').pop()!);
      return handleGetCodeRecord(project, session, id);
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
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  await validatePathUnderRoot(record.filePath, project);

  await writeFile(record.filePath, record.content, 'utf-8');
  const bytesWritten = Buffer.byteLength(record.content, 'utf-8');
  const filePath = record.filePath;

  await manager.markPushed(id);

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, filePath, bytesWritten });
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

  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  // Noop short-circuit: proposed content matches current content exactly.
  if (body.newCode === record.content) {
    return Response.json({
      success: true,
      id,
      hasProposedEdit: !!record.proposedEdit,
      noop: true,
    });
  }

  await manager.setProposedEdit(id, {
    newCode: body.newCode,
    message: typeof body.message === 'string' ? body.message : undefined,
    proposedAt: Date.now(),
    proposedBy: 'claude',
  });

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, id, hasProposedEdit: true });
}

async function handleAcceptProposedEdit(project: string, session: string, id: string, comment?: string): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  if (!record.proposedEdit) {
    return jsonError('No proposed edit to accept', 400);
  }

  const decisionInfo = {
    filePath: record.filePath ?? id,
    proposedBy: record.proposedEdit.proposedBy ?? 'claude',
    proposedAt: record.proposedEdit.proposedAt ?? Date.now(),
    message: record.proposedEdit.message,
    newCode: record.proposedEdit.newCode,
  };

  const oldCode = record.content;

  await manager.updateContent(id, record.proposedEdit.newCode);
  await manager.clearProposedEdit(id);

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }

  const oldLines = oldCode ? oldCode.split('\n').length : 0;
  const newLines = decisionInfo.newCode ? decisionInfo.newCode.split('\n').length : 0;
  const linesAdded = Math.max(0, newLines - oldLines);
  const linesRemoved = Math.max(0, oldLines - newLines);

  try {
    await appendEditDecision(project, session, {
      snippetId: id,
      action: 'accepted',
      scope: 'whole-file',
      filePath: decisionInfo.filePath,
      proposedBy: decisionInfo.proposedBy,
      proposedAt: decisionInfo.proposedAt,
      message: comment ?? decisionInfo.message,
      linesAdded,
      linesRemoved,
    });
  } catch (e) {
    console.error('[appendEditDecision] failed silently:', e);
  }

  return Response.json({ success: true, dirty: true });
}

async function handleRejectProposedEdit(project: string, session: string, id: string, comment?: string): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  // Idempotent: no proposal pending → 200 with noop.
  if (!record.proposedEdit) {
    return Response.json({ success: true, noop: true });
  }

  const decisionInfo = {
    filePath: record.filePath ?? id,
    proposedBy: record.proposedEdit.proposedBy ?? 'claude',
    proposedAt: record.proposedEdit.proposedAt ?? Date.now(),
    message: record.proposedEdit.message,
    newCode: record.proposedEdit.newCode,
    originalCode: record.content,
  };

  await manager.clearProposedEdit(id);

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }

  const rejOldLines = decisionInfo.originalCode ? decisionInfo.originalCode.split('\n').length : 0;
  const rejNewLines = decisionInfo.newCode ? decisionInfo.newCode.split('\n').length : 0;
  const rejLinesAdded = Math.max(0, rejNewLines - rejOldLines);
  const rejLinesRemoved = Math.max(0, rejOldLines - rejNewLines);

  try {
    await appendEditDecision(project, session, {
      snippetId: id,
      action: 'rejected',
      scope: 'whole-file',
      filePath: decisionInfo.filePath,
      proposedBy: decisionInfo.proposedBy,
      proposedAt: decisionInfo.proposedAt,
      message: comment ?? decisionInfo.message,
      linesAdded: rejLinesAdded,
      linesRemoved: rejLinesRemoved,
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

  try {
    await appendEditDecision(project, session, body);
  } catch (err) {
    console.error('Failed to append edit decision:', err);
  }

  return Response.json({ success: true });
}

async function handleSyncFromDisk(project: string, session: string, id: string): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  // Read file from disk
  let diskContent: string;
  try {
    diskContent = await readFile(record.filePath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return Response.json({
        success: true,
        diskChanged: true,
        hasLocalEdits: false,
        conflict: false,
        fileDeleted: true,
      });
    }
    throw err;
  }

  const diskChanged = sha256(diskContent) !== record.contentHash;
  const hasLocalEdits = record.dirty;
  const conflict = diskChanged && hasLocalEdits;

  if (diskChanged && !hasLocalEdits) {
    await manager.markSynced(id, diskContent);
  }

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }

  return Response.json({ success: true, diskChanged, hasLocalEdits, conflict });
}

async function handleGetDiff(project: string, session: string, id: string): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();

  const record = await manager.get(id);
  if (!record) {
    return jsonError(`Code file "${id}" not found`, 404);
  }

  let diskContent: string;
  try {
    diskContent = await readFile(record.filePath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      diskContent = '';
    } else {
      throw err;
    }
  }

  const fileName = record.filePath ?? id;

  const localVsDisk = createPatch(fileName, diskContent, record.content, 'disk', 'local');
  const localVsOriginal = localVsDisk;

  return Response.json({ localVsOriginal, localVsDisk });
}

async function handleCreateCodeArtifact(
  project: string,
  session: string,
  body: { filePath?: unknown; name?: unknown },
): Promise<Response> {
  if (typeof body.filePath !== 'string' || !body.filePath.trim()) {
    return jsonError('body.filePath must be a non-empty string', 400);
  }

  const filePath = body.filePath.trim();

  if (!isAbsolute(project)) {
    return jsonError('project must be an absolute path', 400);
  }
  const projectRoot = resolve(project);

  if (!(await isKnownProject(projectRoot))) {
    return jsonError(`Unknown project: ${projectRoot}`, 400);
  }

  let resolvedPath: string;
  try {
    resolvedPath = await validatePathUnderRoot(filePath, projectRoot);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return jsonError('File not found', 404);
    return jsonError('filePath escapes project root', 400);
  }

  let fileStat;
  try {
    fileStat = await stat(resolvedPath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return jsonError('File not found', 404);
    return jsonError(`Failed to stat file: ${err?.message ?? err}`, 500);
  }

  if (!fileStat.isFile()) {
    return jsonError('Not a regular file', 400);
  }

  if (fileStat.size >= 1_000_000) {
    return jsonError(`File too large (${fileStat.size} bytes). Maximum is 1MB.`, 400);
  }

  const binary = await isBinaryFile(resolvedPath).catch(() => false);
  if (binary) {
    return jsonError('Cannot link binary files', 400);
  }

  const snippetName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : basename(resolvedPath);

  const manager = new CodeFileManager(sessionRegistry.resolvePath(project, session, 'code-files'));
  await manager.initialize();
  const { id } = await manager.createCodeFile(resolvedPath, snippetName);

  const record = await manager.get(id);

  // Broadcast snippet_updated so tabs watching code files pick it up immediately
  const wsHandler = getWebSocketHandler();
  if (wsHandler && record) {
    wsHandler.broadcast({
      type: 'code_file_updated',
      id,
      content: JSON.stringify(record),
      lastModified: record.lastModified,
      project,
      session,
    });
  }

  return Response.json({ id, success: true });
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

  // 2. Code fan-out — grep over code file content
  try {
    const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
    const manager = new CodeFileManager(codeFilesDir);
    await manager.initialize();
    const codeFiles = await manager.list();

    const loweredQuery = truncatedQuery.toLowerCase();

    for (const codeFile of codeFiles) {
      if (results.length >= limit + 1) break; // already over cap; bail early
      if (typeof codeFile.content !== 'string') continue;

      const code = codeFile.content;
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
            filePath: codeFile.filePath,
            line,
            snippet: excerpt,
            snippetId: codeFile.id,
          });
        }

        searchFrom = matchIdx + truncatedQuery.length;
      }
    }
  } catch (err) {
    console.error('[Code Search] code file grep error:', err);
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

async function handleUpdateCodeContent(
  project: string,
  session: string,
  id: string,
  body: { content?: unknown },
): Promise<Response> {
  if (typeof body.content !== 'string') {
    return jsonError('body.content must be a string', 400);
  }
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();
  const record = await manager.get(id);
  if (!record) return jsonError(`Code file "${id}" not found`, 404);
  await manager.updateContent(id, body.content);
  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    const updated = await manager.get(id);
    if (updated) {
      wsHandler.broadcast({
        type: 'code_file_updated',
        id,
        content: JSON.stringify(updated),
        lastModified: updated.lastModified,
        project,
        session,
      });
    }
  }
  const afterUpdate = await manager.get(id);
  return Response.json({ success: true, dirty: true, contentHash: afterUpdate?.contentHash });
}

async function handleGetCodeRecord(
  project: string,
  session: string,
  id: string,
): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();
  const record = await manager.get(id);
  if (!record) return jsonError(`Code file "${id}" not found`, 404);
  return Response.json({
    id: record.id,
    filePath: record.filePath,
    name: record.name,
    language: record.language,
    content: record.content,
    contentHash: record.contentHash,
    dirty: record.dirty,
    lastPushedAt: record.lastPushedAt,
    lastSyncedAt: record.lastSyncedAt,
    hasProposedEdit: !!record.proposedEdit,
    proposedEdit: record.proposedEdit ?? null,
  });
}

async function handlePathExists(project: string, filePath: string): Promise<Response> {
  try {
    const absPath = isAbsolute(filePath) ? filePath : resolve(project, filePath);
    await validatePathUnderRoot(absPath, project);
    await stat(absPath);
    return Response.json({ exists: true });
  } catch { return Response.json({ exists: false }); }
}

async function handleListCodeFiles(project: string, session: string): Promise<Response> {
  const codeFilesDir = sessionRegistry.resolvePath(project, session, 'code-files');
  const manager = new CodeFileManager(codeFilesDir);
  await manager.initialize();
  const files = await manager.list();
  return Response.json({ files: files.map(f => ({ id: f.id, name: f.name, filePath: f.filePath, language: f.language, dirty: f.dirty, lastPushedAt: f.lastPushedAt })) });
}

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
