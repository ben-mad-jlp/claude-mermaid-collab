/**
 * link-file utility
 *
 * Shared helper that links a source file from disk to the current session
 * as a code artifact. Extracts the pattern from Sidebar.handleLinkFile so
 * Feature B (cross-file nav) and GlobalSearch (Cmd+K results) can reuse it.
 */

import { api } from './api';

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
}
