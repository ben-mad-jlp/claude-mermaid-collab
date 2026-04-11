/**
 * pseudo_list_orphaned_prose + pseudo_cleanup_orphaned_prose.
 */

import { unlinkSync, existsSync } from 'node:fs';
import { initPseudoDbV6 } from '../../services/pseudo-db.js';

export interface OrphanEntry {
  prose_file_path: string;
  source_path: string;
  suggestions: Array<{ file_path: string; score: number; reason: string }>;
}

export interface OrphanListResult {
  crossBranch: OrphanEntry[];
  actualOrphans: OrphanEntry[];
}

export async function pseudo_list_orphaned_prose(project: string): Promise<OrphanListResult> {
  const handle = initPseudoDbV6(project);
  const rows = handle.db.query(
    `SELECT prose_file_path, source_path, status, suggestions FROM orphan_prose`,
  ).all() as Array<{ prose_file_path: string; source_path: string; status: string; suggestions: string }>;

  const crossBranch: OrphanEntry[] = [];
  const actualOrphans: OrphanEntry[] = [];
  for (const r of rows) {
    let suggestions: OrphanEntry['suggestions'] = [];
    try {
      suggestions = JSON.parse(r.suggestions || '[]');
    } catch {}
    const entry: OrphanEntry = {
      prose_file_path: r.prose_file_path,
      source_path: r.source_path,
      suggestions,
    };
    if (r.status === 'cross-branch-orphan') crossBranch.push(entry);
    else actualOrphans.push(entry);
  }
  return { crossBranch, actualOrphans };
}

export interface CleanupResult {
  deleted: number;
  errors: Array<{ file: string; error: string }>;
}

export async function pseudo_cleanup_orphaned_prose(
  project: string,
  files: string[],
  confirm: boolean,
): Promise<CleanupResult> {
  if (!confirm) {
    throw new Error('pseudo_cleanup_orphaned_prose: confirm=true required');
  }
  const handle = initPseudoDbV6(project);
  const result: CleanupResult = { deleted: 0, errors: [] };
  const deleteStmt = handle.db.prepare(`DELETE FROM orphan_prose WHERE prose_file_path = ?`);
  for (const f of files) {
    try {
      if (existsSync(f)) unlinkSync(f);
      deleteStmt.run(f);
      result.deleted++;
    } catch (err) {
      result.errors.push({ file: f, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
