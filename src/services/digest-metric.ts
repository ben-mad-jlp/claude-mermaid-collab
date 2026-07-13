/**
 * Digest injection metric report — quantifies whether the project-digest injection
 * is paying for itself by comparing blueprint metrics BEFORE vs AFTER an enabledAt
 * timestamp over a configurable window.
 *
 * KILL CRITERIA (per spec §8 dual kill signal):
 * Remove the digest injection if blueprint avg cache-read does NOT drop ≥15%
 * (deltaPct on avgCacheRead > -15), OR the blueprint reject-rate rises
 * (rejectRate.deltaPct > 0). Either signal alone is sufficient to kill.
 *
 * Read-only reporting module — no mutations, no schema changes, no gate wiring.
 */
import { queryLedger } from './worker-ledger';

export interface DigestMetricPair {
  before: number;
  after: number;
  /** (after-before)/before * 100; null when before === 0 (no baseline). */
  deltaPct: number | null;
}

export interface DigestRefreshCost {
  tokens: number;
  costUsd: number;
  identified: boolean;
  note: string;
}

export interface DigestMetricReport {
  window: { enabledAt: number; windowDays: number; beforeStart: number; afterEnd: number };
  counts: { beforeRuns: number; afterRuns: number };
  avgCacheRead: DigestMetricPair;
  avgNodesSpent: DigestMetricPair;
  rejectRate: DigestMetricPair;
  refreshCost: DigestRefreshCost;
}

function deltaPct(before: number, after: number): number | null {
  return before === 0 ? null : ((after - before) / before) * 100;
}

export function digestMetricReport(
  project: string,
  opts: { enabledAt: number; windowDays?: number },
): DigestMetricReport {
  const windowDays = opts.windowDays ?? 14;
  const windowMs = windowDays * 86_400_000;
  const beforeStart = opts.enabledAt - windowMs;
  const afterEnd = opts.enabledAt + windowMs;

  // Pull candidate rows once
  const rows = queryLedger({ project, since: beforeStart, limit: 2000 }).filter((r) => r.ts < afterEnd);

  // Partition into before/after buckets
  const beforeRows: typeof rows = [];
  const afterRows: typeof rows = [];
  for (const r of rows) {
    if (r.ts < opts.enabledAt) {
      beforeRows.push(r);
    } else {
      afterRows.push(r);
    }
  }

  // Helper to compute metrics for a bucket
  function computeMetrics(bucket: typeof rows) {
    const blueprintRows = bucket.filter((r) => r.nodeKind === 'blueprint');
    const blueprintCount = blueprintRows.length;

    // avgCacheRead: mean of cacheReadTokens
    let sumCacheRead = 0;
    for (const r of blueprintRows) {
      sumCacheRead += r.cacheReadTokens ?? 0;
    }
    const avgCacheRead = blueprintCount > 0 ? sumCacheRead / blueprintCount : 0;

    // avgNodesSpent: mean of nodesSpent
    let sumNodesSpent = 0;
    for (const r of blueprintRows) {
      sumNodesSpent += r.nodesSpent ?? 0;
    }
    const avgNodesSpent = blueprintCount > 0 ? sumNodesSpent / blueprintCount : 0;

    // rejectRate: fraction of blueprint rows whose leafId is "rejected"
    // A leafId is rejected if ANY row in the SAME bucket has:
    // - nodeKind === 'outcome' && leafOutcome ∈ {rejected, blocked}, OR
    // - outcomeDetail JSON has attempts > 1
    const rejectedLeafIds = new Set<string>();
    for (const r of bucket) {
      if (r.leafId == null) continue;
      // Check for outcome marker with rejected/blocked outcome
      if (r.nodeKind === 'outcome' && (r.leafOutcome === 'rejected' || r.leafOutcome === 'blocked')) {
        rejectedLeafIds.add(r.leafId);
      }
      // Check for attempts > 1 in outcomeDetail
      if (r.outcomeDetail != null) {
        try {
          const detail = JSON.parse(r.outcomeDetail);
          if (detail.attempts != null && detail.attempts > 1) {
            rejectedLeafIds.add(r.leafId);
          }
        } catch {
          // Safe parse failure — skip this row
        }
      }
    }

    let rejectedBlueprintCount = 0;
    for (const r of blueprintRows) {
      if (r.leafId != null && rejectedLeafIds.has(r.leafId)) {
        rejectedBlueprintCount += 1;
      }
    }
    const rejectRate = blueprintCount > 0 ? rejectedBlueprintCount / blueprintCount : 0;

    return { avgCacheRead, avgNodesSpent, rejectRate, blueprintCount };
  }

  const beforeMetrics = computeMetrics(beforeRows);
  const afterMetrics = computeMetrics(afterRows);

  // refreshCost: scan ALL kept rows for digest-refresh node
  let refreshTokens = 0;
  let refreshCostUsd = 0;
  let refreshIdentified = false;
  for (const r of rows) {
    if (r.nodeKind != null && /digest.*refresh|refresh.*digest|digest-refresh/i.test(r.nodeKind)) {
      refreshIdentified = true;
      refreshTokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheCreationTokens ?? 0);
      refreshCostUsd += r.costUsd ?? 0;
    }
  }

  const refreshNote = refreshIdentified ? '' : 'no digest-refresh ledger rows found (nodeKind ~/digest.*refresh/); refresh cost reported as 0';

  return {
    window: {
      enabledAt: opts.enabledAt,
      windowDays,
      beforeStart,
      afterEnd,
    },
    counts: {
      beforeRuns: beforeMetrics.blueprintCount,
      afterRuns: afterMetrics.blueprintCount,
    },
    avgCacheRead: {
      before: beforeMetrics.avgCacheRead,
      after: afterMetrics.avgCacheRead,
      deltaPct: deltaPct(beforeMetrics.avgCacheRead, afterMetrics.avgCacheRead),
    },
    avgNodesSpent: {
      before: beforeMetrics.avgNodesSpent,
      after: afterMetrics.avgNodesSpent,
      deltaPct: deltaPct(beforeMetrics.avgNodesSpent, afterMetrics.avgNodesSpent),
    },
    rejectRate: {
      before: beforeMetrics.rejectRate,
      after: afterMetrics.rejectRate,
      deltaPct: deltaPct(beforeMetrics.rejectRate, afterMetrics.rejectRate),
    },
    refreshCost: {
      tokens: refreshTokens,
      costUsd: refreshCostUsd,
      identified: refreshIdentified,
      note: refreshNote,
    },
  };
}
