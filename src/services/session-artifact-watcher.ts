/**
 * Session Artifact Watcher — broadcasts WS delete events when artifact files
 * are removed from disk outside the normal API delete path (e.g. manual deletion
 * or interrupted creation).
 */

import { join, basename, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { sessionRegistry } from './session-registry.js';
import { getWebSocketHandler } from './ws-handler-manager.js';

interface WatchedSession {
  watcher: import('chokidar').FSWatcher;
  refCount: number;
}

const EXT_TO_EVENT: Record<string, string> = {
  '.mmd':     'diagram_deleted',
  '.md':      'document_deleted',
  '.snippet': 'snippet_deleted',
};

// Key: `${project}::${session}`
const watched = new Map<string, WatchedSession>();

function sessionKey(project: string, session: string): string {
  return `${project}::${session}`;
}

const SENTINEL = Symbol('sentinel');

export async function watchSession(project: string, session: string): Promise<void> {
  const key = sessionKey(project, session);
  const existing = watched.get(key);
  if (existing) {
    if (existing !== (SENTINEL as unknown as WatchedSession)) {
      existing.refCount++;
    }
    return;
  }

  // Write sentinel immediately (before any await) so concurrent calls for the
  // same key detect it and return early, preventing a double-watcher leak.
  watched.set(key, SENTINEL as unknown as WatchedSession);

  let chokidar: typeof import('chokidar');
  try {
    chokidar = await import('chokidar');
  } catch {
    console.warn('[session-artifact-watcher] chokidar not available — skipping');
    watched.delete(key);
    return;
  }

  const dirs: string[] = [];
  for (const type of ['diagrams', 'documents', 'snippets'] as const) {
    const dir = sessionRegistry.resolvePath(project, session, type);
    if (existsSync(dir)) dirs.push(dir);
  }

  if (dirs.length === 0) return;

  const watcher = chokidar.watch(dirs, {
    persistent: false,
    ignoreInitial: true,
    depth: 0,
    ignored: (p: string) => basename(p).startsWith('.'),
  });

  watcher.on('unlink', (filePath: string) => {
    const ext = extname(filePath);
    const eventType = EXT_TO_EVENT[ext];
    if (!eventType) return;

    const id = basename(filePath, ext);
    const ws = getWebSocketHandler();
    if (!ws) return;

    ws.broadcast({ type: eventType, id, project, session } as any);
  });

  watched.set(key, { watcher, refCount: 1 });
}

export async function unwatchSession(project: string, session: string): Promise<void> {
  const key = sessionKey(project, session);
  const entry = watched.get(key);
  if (!entry) return;

  entry.refCount--;
  if (entry.refCount > 0) return;

  await entry.watcher.close();
  watched.delete(key);
}
