/**
 * pseudo_import_graph, pseudo_call_chain, pseudo_stats_delta MCP tools.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';

export interface ImportGraphResult {
  file: string;
  imports: string[];
  imported_by: string[];
}

export async function pseudo_import_graph(
  project: string,
  file: string,
): Promise<ImportGraphResult> {
  const handle = initPseudoDbV6(project);
  const db = handle.db;
  const outRows = db.query(`SELECT imported_path FROM file_imports WHERE file_path = ?`).all(file) as Array<{ imported_path: string }>;
  const inRows = db.query(`SELECT file_path FROM file_imports WHERE imported_path = ?`).all(file) as Array<{ file_path: string }>;
  return {
    file,
    imports: outRows.map((r) => r.imported_path),
    imported_by: inRows.map((r) => r.file_path),
  };
}

export interface CallChainOptions {
  direction: 'callers' | 'callees';
  depth?: number;
}

export interface CallChainNode {
  method_id: string;
  depth: number;
  parent_method_id: string | null;
  callee_name: string;
}

export async function pseudo_call_chain(
  project: string,
  methodId: string,
  opts: CallChainOptions,
): Promise<CallChainNode[]> {
  const handle = initPseudoDbV6(project);
  const db = handle.db;
  const maxDepth = Math.min(10, Math.max(1, opts.depth ?? 3));
  const result: CallChainNode[] = [];
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number; parent: string | null; callee_name: string }> = [
    { id: methodId, depth: 0, parent: null, callee_name: '' },
  ];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id) || node.depth > maxDepth) continue;
    visited.add(node.id);
    result.push({
      method_id: node.id,
      depth: node.depth,
      parent_method_id: node.parent,
      callee_name: node.callee_name,
    });
    if (node.depth >= maxDepth) continue;
    if (opts.direction === 'callees') {
      const rows = db.query(
        `SELECT callee_method_id, callee_name FROM method_calls WHERE caller_method_id = ? AND callee_method_id IS NOT NULL`,
      ).all(node.id) as Array<{ callee_method_id: string; callee_name: string }>;
      for (const r of rows) queue.push({ id: r.callee_method_id, depth: node.depth + 1, parent: node.id, callee_name: r.callee_name });
    } else {
      const rows = db.query(
        `SELECT caller_method_id FROM method_calls WHERE callee_method_id = ?`,
      ).all(node.id) as Array<{ caller_method_id: string }>;
      for (const r of rows) queue.push({ id: r.caller_method_id, depth: node.depth + 1, parent: node.id, callee_name: '' });
    }
  }
  return result;
}

export interface StatsDelta {
  since_run_id: number;
  current_run_id: number | null;
  files_changed: number;
  methods_changed: number;
  errors_since: number;
}

export async function pseudo_stats_delta(
  project: string,
  sinceRunId: number,
): Promise<StatsDelta> {
  const handle = initPseudoDbV6(project);
  const db = handle.db;
  const currentRow = db.query(`SELECT id FROM scan_runs ORDER BY id DESC LIMIT 1`).get() as { id?: number } | undefined;
  const errorsRow = db.query(
    `SELECT COUNT(*) AS n FROM scan_errors WHERE scan_run_id > ?`,
  ).get(sinceRunId) as { n: number };
  return {
    since_run_id: sinceRunId,
    current_run_id: currentRow?.id ?? null,
    files_changed: 0,
    methods_changed: 0,
    errors_since: errorsRow?.n ?? 0,
  };
}
