/**
 * pseudo_hot_files, pseudo_list_heuristic_files, pseudo_team_ownership.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';

export interface HotFile {
  file_path: string;
  priority: number;
  touch_count_90d: number;
  last_touched: string | null;
  owner: string | null;
}

export async function pseudo_hot_files(project: string, limit = 50): Promise<HotFile[]> {
  const handle = initPseudoDbV6(project);
  const rows = handle.db.query(
    `SELECT file_path, priority, touch_count_90d, last_touched, owner
       FROM files
      WHERE stub = 0
      ORDER BY priority DESC
      LIMIT ?`,
  ).all(limit) as HotFile[];
  return rows;
}

export interface HeuristicFile {
  file_path: string;
  file_prose_origin: string;
  priority: number;
  lines: number;
}

export async function pseudo_list_heuristic_files(
  project: string,
  opts: { limit?: number; orderBy?: 'priority' | 'lines' | 'file_path' } = {},
): Promise<HeuristicFile[]> {
  const handle = initPseudoDbV6(project);
  const orderBy = opts.orderBy === 'lines' ? 'lines' : opts.orderBy === 'file_path' ? 'file_path' : 'priority';
  const direction = orderBy === 'file_path' ? 'ASC' : 'DESC';
  const rows = handle.db.query(
    `SELECT file_path, file_prose_origin, priority, lines
       FROM files
      WHERE file_prose_origin = 'heuristic'
      ORDER BY ${orderBy} ${direction}
      LIMIT ?`,
  ).all(opts.limit ?? 100) as HeuristicFile[];
  return rows;
}

export interface TeamOwnership {
  owner: string;
  file_count: number;
  total_touches: number;
}

export async function pseudo_team_ownership(project: string): Promise<TeamOwnership[]> {
  const handle = initPseudoDbV6(project);
  const rows = handle.db.query(
    `SELECT owner, COUNT(*) AS file_count, SUM(touch_count_90d) AS total_touches
       FROM files
      WHERE owner IS NOT NULL AND owner != ''
      GROUP BY owner
      ORDER BY total_touches DESC`,
  ).all() as TeamOwnership[];
  return rows;
}
