import type { Diagram, Document, Snippet, Embed, Image, CollabState } from '../types';
import type { Design, Spreadsheet } from '../stores/sessionStore';
import type { UICodeFile } from '../types/code-file';

export interface SessionItemsSnapshot {
  diagrams:     Diagram[];
  documents:    Document[];
  designs:      Design[];
  spreadsheets: Spreadsheet[];
  snippets:     Snippet[];
  codeFiles:    UICodeFile[];
  embeds:       Embed[];
  images:       Image[];
  collabState:  CollabState | null;
  fetchedAt:    number;
}

type SessionCacheKey = string;

export const SESSION_ITEMS_TTL_MS = 5 * 60 * 1000;

const cache = new Map<SessionCacheKey, SessionItemsSnapshot>();

export function makeCacheKey(project: string, session: string): SessionCacheKey {
  return `${project}:${session}`;
}

export function getSessionItemsCache(
  project: string,
  session: string
): SessionItemsSnapshot | undefined {
  return cache.get(makeCacheKey(project, session));
}

export function setSessionItemsCache(
  project: string,
  session: string,
  snapshot: SessionItemsSnapshot
): void {
  cache.set(makeCacheKey(project, session), snapshot);
}

export function patchSessionItemsCache(
  project: string,
  session: string,
  patch: Partial<Omit<SessionItemsSnapshot, 'fetchedAt'>>
): void {
  const key = makeCacheKey(project, session);
  const existing = cache.get(key);
  if (!existing) return;
  cache.set(key, { ...existing, ...patch, fetchedAt: existing.fetchedAt });
}

export function evictSessionItemsCache(project: string, session: string): void {
  cache.delete(makeCacheKey(project, session));
}

export function isCacheStale(snapshot: SessionItemsSnapshot): boolean {
  return Date.now() - snapshot.fetchedAt > SESSION_ITEMS_TTL_MS;
}
