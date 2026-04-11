/**
 * pseudo_search + pseudo_find_function MCP tools — FTS5-backed search.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';
import { searchFts, findFunctionFts, type FtsSearchResult } from '../../services/pseudo-fts.js';

export interface SearchOptions {
  limit?: number;
  filterOrigin?: 'heuristic' | 'manual' | 'llm' | 'mixed';
}

export interface SearchHit extends FtsSearchResult {
  prose_origin?: string;
  match_quality?: string | null;
}

export async function pseudo_search(
  project: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const handle = initPseudoDbV6(project);
  const results = searchFts(handle.db, query, opts.limit ?? 50);
  if (!opts.filterOrigin) return enrich(handle.db, results);
  const filtered = filterByOrigin(handle.db, results, opts.filterOrigin);
  return enrich(handle.db, filtered);
}

export async function pseudo_find_function(
  project: string,
  name: string,
  limit = 20,
): Promise<SearchHit[]> {
  const handle = initPseudoDbV6(project);
  const results = findFunctionFts(handle.db, name, limit);
  return enrich(handle.db, results);
}

function enrich(db: any, results: FtsSearchResult[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const r of results) {
    const row = db.query(
      `SELECT file_prose_origin FROM files WHERE file_path = ?`,
    ).get(r.file_path) as { file_prose_origin?: string } | undefined;
    out.push({
      ...r,
      prose_origin: row?.file_prose_origin ?? 'none',
    });
  }
  return out;
}

function filterByOrigin(db: any, results: FtsSearchResult[], origin: string): FtsSearchResult[] {
  const out: FtsSearchResult[] = [];
  for (const r of results) {
    const row = db.query(
      `SELECT file_prose_origin FROM files WHERE file_path = ?`,
    ).get(r.file_path) as { file_prose_origin?: string } | undefined;
    if (row?.file_prose_origin === origin) out.push(r);
  }
  return out;
}
