/**
 * link-file utility
 *
 * Shared helper that links a source file from disk to the current session
 * as a code artifact. Extracts the pattern from Sidebar.handleLinkFile so
 * Feature B (cross-file nav) and GlobalSearch (Cmd+K results) can reuse it.
 */

import { api } from './api';
import { useSessionStore } from '../stores/sessionStore';

// Per-key in-flight promise cache: avoids duplicate createSnippet calls when
// two concurrent linkFile invocations for the same filePath both miss the
// snippet-store dedupe (e.g. rapid double-click or auto-promote racing a
// manual click). First caller installs a promise; second caller reuses it.
const inflight = new Map<string, Promise<string>>();

/**
 * Link a source file to the current session as a code artifact.
 * Creates a linked snippet with an empty envelope, then immediately syncs
 * the file content from disk. Returns the new snippet ID.
 *
 * Throws if the snippet cannot be created.
 */
export async function linkFile(
  project: string,
  session: string,
  filePath: string,
): Promise<string> {
  // Scope-guard the dedupe cache: the snippets store reflects the *currently
  // selected* session only, so consulting it for a different session would
  // return a snippet that belongs to the wrong session. If the caller's
  // project/session don't match the current session, skip the cache entirely
  // and fall through to createSnippet.
  const state = useSessionStore.getState();
  const cs = state.currentSession;
  const sameSession =
    !!cs && cs.project === project && cs.name === session;

  if (sameSession) {
    for (const s of state.snippets) {
      try {
        const parsed = JSON.parse(s.content);
        if (parsed?.filePath === filePath) {
          return s.id;
        }
      } catch {
        continue;
      }
    }
  }

  const key = `${project}::${session}::${filePath}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const name = filePath.split('/').pop() || 'code';
    const envelope = {
      code: '',
      language: '',
      filePath,
      originalCode: '',
      diskCode: '',
      linked: true,
      linkCreatedAt: Date.now(),
      lastPushedAt: null,
      lastSyncedAt: Date.now(),
      dirty: false,
    };
    const result = await api.createSnippet(project, session, name, JSON.stringify(envelope));
    if (!result?.id) {
      throw new Error('Failed to create linked snippet');
    }
    await api.syncCodeFromDisk(project, session, result.id);
    return result.id;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
