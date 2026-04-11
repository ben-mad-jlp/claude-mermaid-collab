/**
 * pseudo_get_file_state — returns v6 file state with overlay warnings.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';

export interface MethodStateV6 {
  id: string;
  name: string;
  enclosing_class: string | null;
  normalized_params: string;
  is_async: boolean;
  is_exported: boolean;
  start_line: number | null;
  end_line: number | null;
  prose_origin: string;
  match_quality: string | null;
  warning: string | null;
  steps: Array<{ order: number; content: string }>;
}

export interface FileStateV6 {
  file: string;
  file_prose_origin: string;
  title: string;
  purpose: string;
  module_context: string;
  lines: number;
  stub: boolean;
  warnings: Array<{ method_row_id: string; quality: string; warning: string | null }>;
  methods: MethodStateV6[];
}

export async function pseudo_get_file_state(
  project: string,
  filePath: string,
): Promise<FileStateV6 | null> {
  const handle = initPseudoDbV6(project);
  const db = handle.db;

  const fileRow = db.query(
    `SELECT file_path, title, purpose, module_context, file_prose_origin, lines, stub
       FROM files WHERE file_path = ?`,
  ).get(filePath) as any;

  if (!fileRow) return null;

  const methodRows = db.query(
    `SELECT id, name, enclosing_class, normalized_params, is_async, is_exported,
            start_line, end_line, prose_origin, match_quality, warning
       FROM methods WHERE file_path = ?
       ORDER BY start_line`,
  ).all(filePath) as Array<any>;

  const stepStmt = db.prepare(
    `SELECT "order", content FROM method_steps WHERE method_id = ? ORDER BY "order"`,
  );

  const methods: MethodStateV6[] = methodRows.map((m) => ({
    id: m.id,
    name: m.name,
    enclosing_class: m.enclosing_class,
    normalized_params: m.normalized_params,
    is_async: !!m.is_async,
    is_exported: !!m.is_exported,
    start_line: m.start_line,
    end_line: m.end_line,
    prose_origin: m.prose_origin,
    match_quality: m.match_quality,
    warning: m.warning,
    steps: stepStmt.all(m.id) as Array<{ order: number; content: string }>,
  }));

  const methodIds = methodRows.map((m) => m.id);
  const warnings = methodIds.length === 0 ? [] : (db.query(
    `SELECT method_row_id, quality, warning
       FROM overlay_matches
      WHERE method_row_id IN (${methodIds.map(() => '?').join(',')})
        AND quality != 'exact'`,
  ).all(...methodIds) as Array<{ method_row_id: string; quality: string; warning: string | null }>);

  return {
    file: fileRow.file_path,
    file_prose_origin: fileRow.file_prose_origin,
    title: fileRow.title,
    purpose: fileRow.purpose,
    module_context: fileRow.module_context,
    lines: fileRow.lines,
    stub: !!fileRow.stub,
    warnings,
    methods,
  };
}
