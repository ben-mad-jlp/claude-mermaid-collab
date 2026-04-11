/**
 * pseudo_rescan / pseudo_rerank MCP tools.
 */

import { initPseudoDbV6 } from '../../services/pseudo-db.js';
import { runRanking } from '../../services/pseudo-ranking.js';

export interface RescanOptions {
  mode?: 'full' | 'incremental' | 'drift_check';
  paths?: string[];
  cancel?: boolean;
}

export interface RescanResult {
  triggered: boolean;
  status: string;
  message?: string;
  scanRunId?: number;
}

export async function pseudo_rescan(
  project: string,
  opts: RescanOptions = {},
): Promise<RescanResult> {
  const handle = initPseudoDbV6(project);

  if (opts.cancel) {
    handle.indexer.cancel();
    return { triggered: false, status: 'cancel-requested', message: 'indexer cancel() invoked' };
  }

  const mode = opts.mode ?? 'full';

  try {
    if (mode === 'full') {
      const run = await handle.indexer.runFullScan({ trigger: 'manual' });
      return { triggered: true, status: run.status, scanRunId: run.id };
    }
    if (mode === 'incremental') {
      const paths = opts.paths ?? [];
      const run = await handle.indexer.runIncrementalScan(paths, { trigger: 'manual' });
      return { triggered: true, status: run.status, scanRunId: run.id };
    }
    if (mode === 'drift_check') {
      const report = handle.drift
        ? await handle.drift.checkNow('full')
        : { checkedFiles: 0, changedFiles: [] };
      return {
        triggered: true,
        status: 'drift-check-done',
        message: `${report.changedFiles.length} changed of ${report.checkedFiles} checked`,
      };
    }
    return { triggered: false, status: 'unknown-mode', message: `mode=${mode}` };
  } catch (err) {
    return {
      triggered: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface RerankOptions {
  cancel?: boolean;
  sinceDaysAgo?: number;
}

export interface RerankResult {
  updatedRows: number;
  message?: string;
}

export async function pseudo_rerank(
  project: string,
  opts: RerankOptions = {},
): Promise<RerankResult> {
  const handle = initPseudoDbV6(project);
  if (opts.cancel) {
    handle.indexer.cancel();
    return { updatedRows: 0, message: 'cancel-requested' };
  }
  try {
    const n = await runRanking(handle.db, project, { sinceDaysAgo: opts.sinceDaysAgo });
    return { updatedRows: n };
  } catch (err) {
    return {
      updatedRows: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
