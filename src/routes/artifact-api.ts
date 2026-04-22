/**
 * Artifact API Routes
 *
 * REST API endpoints for generic artifact operations:
 *   GET  /exists   — check whether an artifact file exists on disk
 *   POST /register — verify a newly-written file and register it in metadata + broadcast WS_CREATED
 *   POST /notify   — re-read an existing file, optionally hash-check, and broadcast WS_UPDATED
 */

import { readFile, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { sessionRegistry } from '../services/session-registry.js';
import { MetadataManager } from '../services/metadata-manager.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { config } from '../config.js';

type ArtifactType = 'diagram' | 'document' | 'snippet' | 'design' | 'spreadsheet' | 'embed';

const EXT: Record<ArtifactType, string> = {
  diagram: '.mmd',
  document: '.md',
  snippet: '.snippet',
  design: '.design.json',
  spreadsheet: '.spreadsheet',
  embed: '.embed.json',
};

const FOLDER: Record<ArtifactType, string> = {
  diagram: 'diagrams',
  document: 'documents',
  snippet: 'snippets',
  design: 'designs',
  spreadsheet: 'spreadsheets',
  embed: 'embeds',
};

const WS_CREATED: Record<ArtifactType, string> = {
  diagram: 'diagram_created',
  document: 'document_created',
  snippet: 'snippet_created',
  design: 'design_created',
  spreadsheet: 'spreadsheet_created',
  embed: 'embed_created',
};

const WS_UPDATED: Record<ArtifactType, string> = {
  diagram: 'diagram_updated',
  document: 'document_updated',
  snippet: 'snippet_updated',
  design: 'design_updated',
  spreadsheet: 'spreadsheet_updated',
  embed: 'embed_updated',
};

export async function handleArtifactAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/artifact', '');

  const project = url.searchParams.get('project');
  const session = url.searchParams.get('session');
  const typeParam = url.searchParams.get('type') as ArtifactType | null;
  const id = url.searchParams.get('id');

  if (!project) return jsonError('Missing required query parameter: project', 400);
  if (typeParam !== null && !(typeParam in EXT)) {
    return jsonError(`Invalid artifact type: "${typeParam}". Must be one of: ${Object.keys(EXT).join(', ')}`, 400);
  }

  try {
    if (path === '/exists' && req.method === 'GET') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      if (!typeParam) return jsonError('Missing required query parameter: type', 400);
      if (!id) return jsonError('Missing required query parameter: id', 400);
      return handleArtifactExists(project, session, typeParam, id);
    }

    if (path === '/register' && req.method === 'POST') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      if (!typeParam) return jsonError('Missing required query parameter: type', 400);
      if (!id) return jsonError('Missing required query parameter: id', 400);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      return handleArtifactRegister(project, session, typeParam, id, body);
    }

    if (path === '/notify' && req.method === 'POST') {
      if (!session) return jsonError('Missing required query parameter: session', 400);
      if (!typeParam) return jsonError('Missing required query parameter: type', 400);
      if (!id) return jsonError('Missing required query parameter: id', 400);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      return handleArtifactNotify(project, session, typeParam, id, body);
    }

    return jsonError('Not found', 404);
  } catch (err: any) {
    console.error('[artifact-api] Unhandled error:', err?.message ?? err);
    return jsonError(err?.message ?? String(err), 500);
  }
}

async function handleArtifactExists(
  project: string,
  session: string,
  type: ArtifactType,
  id: string,
): Promise<Response> {
  const filePath = resolveArtifactPath(project, session, type, id);
  try {
    await stat(filePath);
    return Response.json({ exists: true, filePath });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return Response.json({ exists: false }, { status: 404 });
    return jsonError(`Failed to stat artifact: ${err?.message ?? err}`, 500);
  }
}

async function handleArtifactRegister(
  project: string,
  session: string,
  type: ArtifactType,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const filePath = resolveArtifactPath(project, session, type, id);

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return jsonError(`Artifact file not found on disk: ${filePath}`, 404);
    return jsonError(`Failed to stat artifact: ${err?.message ?? err}`, 500);
  }

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err: any) {
    return jsonError(`Failed to read artifact: ${err?.message ?? err}`, 500);
  }

  if (Buffer.byteLength(content, 'utf-8') > config.MAX_FILE_SIZE) {
    return jsonError(`Artifact file too large. Maximum is ${config.MAX_FILE_SIZE} bytes.`, 400);
  }

  if (EXT[type].endsWith('.json')) {
    try { JSON.parse(content); } catch {
      return jsonError('Artifact file contains invalid JSON', 400);
    }
  }

  const sessionDir = sessionRegistry.resolvePath(project, session, '.');
  const metadataManager = new MetadataManager(sessionDir);
  await metadataManager.initialize();

  const metaUpdates: Record<string, unknown> = {};
  if (typeof body.folder === 'string' || body.folder === null) metaUpdates.folder = body.folder;
  if (typeof body.locked === 'boolean') metaUpdates.locked = body.locked;
  if (typeof body.deprecated === 'boolean') metaUpdates.deprecated = body.deprecated;
  if (typeof body.pinned === 'boolean') metaUpdates.pinned = body.pinned;
  if (typeof body.blueprint === 'boolean') metaUpdates.blueprint = body.blueprint;

  await metadataManager.updateItem(id, metaUpdates);

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    wsHandler.broadcast({
      type: WS_CREATED[type],
      id,
      name: id,
      content,
      lastModified: fileStats.mtimeMs,
      project,
      session,
    } as any);
  }

  return Response.json({ success: true, id, filePath });
}

async function handleArtifactNotify(
  project: string,
  session: string,
  type: ArtifactType,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const filePath = resolveArtifactPath(project, session, type, id);

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return jsonError(`Artifact file not found on disk: ${filePath}`, 404);
    return jsonError(`Failed to stat artifact: ${err?.message ?? err}`, 500);
  }

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err: any) {
    return jsonError(`Failed to read artifact: ${err?.message ?? err}`, 500);
  }

  if (Buffer.byteLength(content, 'utf-8') > config.MAX_FILE_SIZE) {
    return jsonError(`Artifact file too large. Maximum is ${config.MAX_FILE_SIZE} bytes.`, 400);
  }

  if (typeof body.expectedHash === 'string') {
    const actualHash = sha256(content);
    if (actualHash !== body.expectedHash) {
      return jsonError(`Hash mismatch: expected ${body.expectedHash}, got ${actualHash}`, 409);
    }
  }

  if (EXT[type].endsWith('.json')) {
    try { JSON.parse(content); } catch {
      return jsonError('Artifact file contains invalid JSON', 400);
    }
  }

  try {
    await appendHistory(project, session, type, id, content, fileStats.mtimeMs);
  } catch (err: any) {
    console.warn('[artifact-api] Failed to append history:', err?.message ?? err);
  }

  const wsHandler = getWebSocketHandler();
  if (wsHandler) {
    wsHandler.broadcast({
      type: WS_UPDATED[type],
      id,
      content,
      lastModified: fileStats.mtimeMs,
      project,
      session,
    } as any);
  }

  return Response.json({ success: true, id, filePath, lastModified: fileStats.mtimeMs });
}

async function appendHistory(
  project: string,
  session: string,
  type: ArtifactType,
  id: string,
  content: string,
  ts: number,
): Promise<void> {
  const sessionDir = sessionRegistry.resolvePath(project, session, '.');
  const historyDir = join(sessionDir, FOLDER[type], '.history');
  await mkdir(historyDir, { recursive: true });
  await writeFile(join(historyDir, `${id}-${ts}${EXT[type]}`), content, 'utf-8');
}

function resolveArtifactPath(project: string, session: string, type: ArtifactType, id: string): string {
  try {
    const dir = sessionRegistry.resolvePath(project, session, FOLDER[type] as any);
    return join(dir, `${id}${EXT[type]}`);
  } catch {
    const sessionDir = sessionRegistry.resolvePath(project, session, '.');
    return join(sessionDir, FOLDER[type], `${id}${EXT[type]}`);
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
