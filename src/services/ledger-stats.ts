/**
 * Ledger aggregation (PAW P4a) — the READ-side data source over the worker-ledger
 * NODE rows written by the leaf-executor's `recordNode`. Two pure aggregations:
 *
 *   - `getLeafRun(leafId)`  → the per-todo run view (one leaf): chronological node
 *      list, attempts, node-budget usage, wall-clock, authMode audit, and (when the
 *      executor's R1 write-back landed) the review verdict + final outcome.
 *   - `getFleetStats(opts)` → fleet/aggregate stats across many leaves, including the
 *      first-class authMode audit + alarm (the subscription-only invariant made
 *      visible) and the block-rate.
 *
 * Both compose `queryLedger` (and the additive `leafId` filter) — they invent no new
 * storage or transport. Surfaced as plain GET endpoints (no new WS event type —
 * constraint b2fe36b1). The Bridge fetches them on demand / on existing ws nudges.
 *
 * Assumptions (documented):
 *   - R2: `attempts` = count of `nodeKind==='blueprint'` rows (the P2 floor starts
 *     each fresh attempt with exactly one blueprint node). Revisit if P5/P6 changes
 *     the node sequence.
 *   - R3: the leafId query is unindexed (scanned under the 2000-row cap). Fine at
 *     current volume; add `idx_ledger_leaf` if it grows.
 *   - The executor emits a terminal `nodeKind:'outcome'` marker row (nodesSpent:0)
 *     carrying `leafOutcome` + the deciding `verdict`. It is EXCLUDED from the
 *     node-list / attempts / budget math, and only its verdict/outcome are read.
 */
import { queryLedger } from './worker-ledger';
import { NODE_BUDGET } from './leaf-executor';

export interface LeafNodeStat {
  nodeKind: string | null; // 'blueprint'|'implement'|'review'
  model: string;
  authMode: string | null;
  exitCode: number | null;
  durationMs: number | null;
  rateLimited: boolean | null;
  ts: number;
  verdict?: string | null;
  inputTokens?: number | null; // context size in (a tiny value flags a starved node)
  outputTokens?: number | null;
  outputText?: string | null; // the node's final message — drillable in the UI
}

export interface LeafRunStats {
  leafId: string;
  epicId: string | null;
  project: string;
  nodes: LeafNodeStat[]; // chronological (ts, id ascending)
  attempts: number; // = count of nodeKind==='blueprint' rows; min 1 if any nodes
  nodesSpent: number; // Σ nodesSpent (fallback: nodes.length)
  nodeBudget: number; // constant 20 (NODE_BUDGET)
  budgetPct: number; // nodesSpent / nodeBudget
  wallClockMs: number; // last.ts − first.ts (fallback Σ durationMs)
  rateLimitedCount: number; // nodes where rateLimited===true
  authModes: Record<string, number>; // count by authMode (the per-leaf audit)
  finalOutcome: 'accepted' | 'rejected' | 'pending' | 'blocked' | 'paused' | null;
  reviewVerdict: 'pass' | 'fail' | null;
  /** The atomic terminal record (parsed from the outcome marker's `outcomeDetail` JSON):
   *  the single-source acceptance decision. Null when the run has no terminal marker yet
   *  (in-flight) or predates the field. */
  terminal?: {
    effectiveOutcome?: string;
    reviewVerdict?: 'pass' | 'fail' | null;
    pathTaken?: 'floor' | 'waves' | null;
    reason?: string;
    pendingReason?: string;
    gateReasons?: string[];
    attempts?: number;
    nodesSpent?: number;
  } | null;
}

export interface FleetStats {
  leafCount: number;
  nodesPerLeafAvg: number;
  attemptRate: number; // Σ attempts / leafCount
  blockRate: number; // leaves with finalOutcome==='blocked' / leafCount
  capPauseCount: number; // node rows with rateLimited===true
  capPauseMs: number; // Σ durationMs of rate-limited rows (best-effort)
  authModeAudit: Record<string, number>; // count by authMode — MUST be {subscription: N}
  authModeAlarm: boolean; // true iff any non-'subscription' authMode count > 0
  wallClock: { p50: number; p90: number; max: number }; // per-leaf wallClockMs distribution
}

/** A terminal marker row (carries outcome/verdict only, nodesSpent:0). Excluded
 *  from the node list and budget/attempt math. */
function isOutcomeMarker(r: { nodeKind?: string | null }): boolean {
  return r.nodeKind === 'outcome';
}

/** Per-leaf run view. Returns null when no rows exist for the leaf. */
export function getLeafRun(leafId: string): LeafRunStats | null {
  // Ascending chronological order (queryLedger returns newest-first).
  const rows = queryLedger({ leafId, limit: 2000 }).slice().reverse();
  if (rows.length === 0) return null;

  const markers = rows.filter(isOutcomeMarker);
  const nodeRows = rows.filter((r) => !isOutcomeMarker(r));

  const nodes: LeafNodeStat[] = nodeRows.map((r) => ({
    nodeKind: r.nodeKind ?? null,
    model: r.model,
    authMode: r.authMode ?? null,
    exitCode: r.exitCode ?? null,
    durationMs: r.durationMs ?? null,
    rateLimited: r.rateLimited ?? null,
    ts: r.ts,
    verdict: r.verdict ?? null,
    inputTokens: r.inputTokens ?? null,
    outputTokens: r.outputTokens ?? null,
    outputText: r.outputText ?? null,
  }));

  const attempts = Math.max(
    nodeRows.filter((r) => r.nodeKind === 'blueprint').length,
    nodeRows.length > 0 ? 1 : 0,
  );

  const nodesSpent =
    nodeRows.reduce((s, r) => s + (r.nodesSpent ?? 0), 0) || nodeRows.length;

  const tsList = rows.map((r) => r.ts);
  const wallClockMs =
    tsList.length > 1
      ? Math.max(...tsList) - Math.min(...tsList)
      : nodeRows.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  const rateLimitedCount = nodeRows.filter((r) => r.rateLimited === true).length;

  const authModes: Record<string, number> = {};
  for (const r of nodeRows) {
    const k = r.authMode ?? 'unknown';
    authModes[k] = (authModes[k] ?? 0) + 1;
  }

  // verdict/outcome: prefer the terminal marker; fall back to a verdict stamped on
  // any review row (defensive — the executor stamps it on the marker).
  const lastMarker = markers[markers.length - 1];
  const reviewVerdict =
    (lastMarker?.verdict as 'pass' | 'fail' | undefined) ??
    (nodeRows.map((r) => r.verdict).filter(Boolean).pop() as 'pass' | 'fail' | undefined) ??
    null;
  const finalOutcome =
    (lastMarker?.leafOutcome as LeafRunStats['finalOutcome']) ?? null;

  // Atomic terminal record: parse the marker's outcomeDetail JSON (fail-safe → null).
  let terminal: LeafRunStats['terminal'] = null;
  if (lastMarker?.outcomeDetail) {
    try { terminal = JSON.parse(lastMarker.outcomeDetail); } catch { terminal = null; }
  }

  return {
    leafId,
    epicId: rows[0].epicId ?? null,
    project: rows[0].project,
    nodes,
    attempts,
    nodesSpent,
    nodeBudget: NODE_BUDGET,
    budgetPct: NODE_BUDGET > 0 ? nodesSpent / NODE_BUDGET : 0,
    wallClockMs,
    rateLimitedCount,
    authModes,
    finalOutcome,
    reviewVerdict,
    terminal,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Fleet / aggregate stats across leaves (optionally filtered). */
export function getFleetStats(
  opts: { project?: string; sinceTs?: number; epicId?: string } = {},
): FleetStats {
  const rows = queryLedger({
    project: opts.project,
    epicId: opts.epicId,
    since: opts.sinceTs,
    limit: 2000,
  });
  // Keep only ledger rows that belong to a leaf run (node rows + outcome markers).
  const leafRows = rows.filter((r) => r.leafId != null);

  // Group by leafId.
  const byLeaf = new Map<string, typeof leafRows>();
  for (const r of leafRows) {
    const id = r.leafId as string;
    let g = byLeaf.get(id);
    if (!g) { g = []; byLeaf.set(id, g); }
    g.push(r);
  }

  const authModeAudit: Record<string, number> = {};
  let capPauseCount = 0;
  let capPauseMs = 0;
  let totalNodesSpent = 0;
  let totalAttempts = 0;
  let blockedLeaves = 0;
  const wallClocks: number[] = [];

  for (const [, group] of byLeaf) {
    const nodeRows = group.filter((r) => !isOutcomeMarker(r));
    const markers = group.filter(isOutcomeMarker);

    totalNodesSpent += nodeRows.reduce((s, r) => s + (r.nodesSpent ?? 0), 0) || nodeRows.length;
    totalAttempts += Math.max(
      nodeRows.filter((r) => r.nodeKind === 'blueprint').length,
      nodeRows.length > 0 ? 1 : 0,
    );

    for (const r of nodeRows) {
      const k = r.authMode ?? 'unknown';
      authModeAudit[k] = (authModeAudit[k] ?? 0) + 1;
      if (r.rateLimited === true) {
        capPauseCount += 1;
        capPauseMs += r.durationMs ?? 0;
      }
    }

    const lastMarker = markers[markers.length - 1];
    if ((lastMarker?.leafOutcome ?? null) === 'blocked') blockedLeaves += 1;

    const tsList = group.map((r) => r.ts);
    wallClocks.push(tsList.length > 1 ? Math.max(...tsList) - Math.min(...tsList) : 0);
  }

  const leafCount = byLeaf.size;
  const sorted = wallClocks.slice().sort((a, b) => a - b);

  // authMode invariant: every node MUST be 'subscription'. Any other key (api /
  // unknown / null) with count > 0 raises the alarm — non-subscription made loud.
  const authModeAlarm = Object.entries(authModeAudit).some(
    ([k, n]) => k !== 'subscription' && n > 0,
  );

  return {
    leafCount,
    nodesPerLeafAvg: leafCount > 0 ? totalNodesSpent / leafCount : 0,
    attemptRate: leafCount > 0 ? totalAttempts / leafCount : 0,
    blockRate: leafCount > 0 ? blockedLeaves / leafCount : 0,
    capPauseCount,
    capPauseMs,
    authModeAudit,
    authModeAlarm,
    wallClock: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
    },
  };
}

/** One-line-per-leaf run summary (newest-first) — the triage list behind the
 *  `leaf_failures` / `leaf_runs` MCP tool. Groups ledger rows by leafId and reads the
 *  terminal marker for the authoritative outcome + reason. */
export interface LeafRunSummary {
  leafId: string;
  project: string;
  epicId: string | null;
  finalOutcome: LeafRunStats['finalOutcome'];
  reviewVerdict: 'pass' | 'fail' | null;
  /** Human reason from the atomic terminal record (reason ?? pendingReason). */
  reason: string | null;
  pathTaken: 'floor' | 'waves' | null;
  lastTs: number;
  nodesSpent: number;
  costUsd: number;
}

export function listLeafRuns(
  opts: { project?: string; epicId?: string; sinceTs?: number; limit?: number } = {},
): LeafRunSummary[] {
  const rows = queryLedger({ project: opts.project, epicId: opts.epicId, since: opts.sinceTs, limit: 2000 })
    .filter((r) => r.leafId != null);
  const byLeaf = new Map<string, typeof rows>();
  for (const r of rows) {
    const id = r.leafId as string;
    let g = byLeaf.get(id);
    if (!g) { g = []; byLeaf.set(id, g); }
    g.push(r);
  }
  const out: LeafRunSummary[] = [];
  for (const [leafId, group] of byLeaf) {
    const markers = group.filter(isOutcomeMarker);
    const nodeRows = group.filter((r) => !isOutcomeMarker(r));
    // queryLedger returns newest-first, so the LATEST marker is the max-ts one (NOT
    // markers[last], which is the oldest). A re-run leaf must report its newest outcome.
    const lastMarker = [...markers].sort((a, b) => a.ts - b.ts).pop();
    let terminal: LeafRunStats['terminal'] = null;
    if (lastMarker?.outcomeDetail) { try { terminal = JSON.parse(lastMarker.outcomeDetail); } catch { terminal = null; } }
    out.push({
      leafId,
      project: group[0].project,
      epicId: group[0].epicId ?? null,
      finalOutcome: (lastMarker?.leafOutcome as LeafRunStats['finalOutcome']) ?? null,
      reviewVerdict: (lastMarker?.verdict as 'pass' | 'fail' | undefined) ?? null,
      reason: terminal?.reason ?? terminal?.pendingReason ?? null,
      pathTaken: terminal?.pathTaken ?? null,
      lastTs: Math.max(...group.map((r) => r.ts)),
      nodesSpent: nodeRows.reduce((s, r) => s + (r.nodesSpent ?? 0), 0) || nodeRows.length,
      costUsd: group.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    });
  }
  out.sort((a, b) => b.lastTs - a.lastTs);
  return opts.limit ? out.slice(0, opts.limit) : out;
}
