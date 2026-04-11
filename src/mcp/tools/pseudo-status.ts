/**
 * pseudo_db_status — MCP tool reporting pseudo-index health.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';
import { SCHEMA_VERSION } from '../../services/pseudo-schema.js';
import { detectCtags } from '../../services/pseudo-ctags.js';

export interface PseudoDbStatus {
  schemaVersion: number;
  fileCount: number;
  filesWithProse: number;
  proseBreakdown: {
    heuristic: number;
    manual: number;
    llm: number;
    mixed: number;
    none: number;
  };
  lastScan: {
    id: number;
    trigger: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    files_scanned: number;
    errors: number;
  } | null;
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  warnings: {
    orphanCount: number;
    crossBranchOrphanCount: number;
    renameWarnings: number;
    paramDriftWarnings: number;
  };
  ctagsAvailable: boolean;
  ctagsVersion: string | null;
  cacheMode: 'memory' | 'warm-loaded' | 'cold';
  handleStatus: string;
  lastError: string | null;
}

export async function pseudo_db_status(project: string): Promise<PseudoDbStatus> {
  const handle = initPseudoDbV6(project);
  const db = handle.db;

  const fileCountRow = db.query(`SELECT COUNT(*) AS n FROM files`).get() as { n: number };
  const fileCount = fileCountRow?.n ?? 0;

  const filesWithProseRow = db.query(
    `SELECT COUNT(*) AS n FROM files WHERE file_prose_origin != 'none'`,
  ).get() as { n: number };
  const filesWithProse = filesWithProseRow?.n ?? 0;

  const breakdown = { heuristic: 0, manual: 0, llm: 0, mixed: 0, none: 0 };
  const rows = db.query(
    `SELECT prose_origin AS origin, COUNT(*) AS n FROM methods GROUP BY prose_origin`,
  ).all() as Array<{ origin: string; n: number }>;
  for (const r of rows) {
    if (r.origin in breakdown) (breakdown as any)[r.origin] = r.n;
  }

  const lastScan = db.query(
    `SELECT id, trigger, status, started_at, finished_at, files_scanned, errors FROM scan_runs ORDER BY id DESC LIMIT 1`,
  ).get() as PseudoDbStatus['lastScan'];

  const runningScan = db.query(
    `SELECT files_scanned FROM scan_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`,
  ).get() as { files_scanned?: number } | undefined;

  const isScanning = handle.status() === 'cold-scanning' || handle.status() === 'warm-loading' || !!runningScan;

  const orphanCountRow = db.query(
    `SELECT COUNT(*) AS n FROM orphan_prose WHERE status = 'orphan-candidate'`,
  ).get() as { n: number };
  const crossBranchRow = db.query(
    `SELECT COUNT(*) AS n FROM orphan_prose WHERE status = 'cross-branch-orphan'`,
  ).get() as { n: number };
  const renameWarningsRow = db.query(
    `SELECT COUNT(*) AS n FROM overlay_matches WHERE quality IN ('fuzzy_rename','fuzzy_move')`,
  ).get() as { n: number };
  const paramDriftRow = db.query(
    `SELECT COUNT(*) AS n FROM overlay_matches WHERE quality = 'param_mismatch'`,
  ).get() as { n: number };

  const ctags = await detectCtags().catch(() => ({ available: false, isUniversal: false, version: undefined as string | undefined }));

  const handleState = handle.status();
  const cacheMode: PseudoDbStatus['cacheMode'] =
    handleState === 'warm-loaded' || handleState === 'ready' ? 'warm-loaded'
    : handleState === 'cold-scanning' ? 'cold'
    : 'memory';

  return {
    schemaVersion: SCHEMA_VERSION,
    fileCount,
    filesWithProse,
    proseBreakdown: breakdown,
    lastScan,
    isScanning,
    scanProgress: runningScan ? { current: runningScan.files_scanned ?? 0, total: fileCount } : null,
    warnings: {
      orphanCount: orphanCountRow?.n ?? 0,
      crossBranchOrphanCount: crossBranchRow?.n ?? 0,
      renameWarnings: renameWarningsRow?.n ?? 0,
      paramDriftWarnings: paramDriftRow?.n ?? 0,
    },
    ctagsAvailable: ctags.available,
    ctagsVersion: ctags.version ?? null,
    cacheMode,
    handleStatus: handleState,
    lastError: handle.lastError()?.message ?? null,
  };
}
