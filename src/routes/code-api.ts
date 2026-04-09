/**
 * Code API Routes
 *
 * REST API endpoints for linked code file operations:
 * listing project files, pushing snippets to disk, syncing from disk, and computing diffs.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { createPatch } from 'diff';
import { sessionRegistry } from '../services/session-registry.js';
import { SnippetManager } from '../services/snippet-manager.js';
import { validatePathUnderRoot } from '../utils/path-security.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';

// Directories and files to exclude from file listings
const EXCLUDED_NAMES = new Set([
  'node_modules',
  '.git',
  '.collab',
  '.DS_Store',
  '.env',
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
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

async function handleListProjectFiles(project: string, dirPath?: string): Promise<Response> {
  const targetDir = dirPath ? join(project, dirPath) : project;

  // Validate the path is under the project root
  await validatePathUnderRoot(targetDir, project);

  const dirEntries = await readdir(targetDir, { withFileTypes: true });

  const entries: FileEntry[] = [];
  for (const entry of dirEntries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const entryPath = join(targetDir, entry.name);
    const isDir = entry.isDirectory();

    const fileEntry: FileEntry = {
      name: entry.name,
      path: entryPath,
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

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
