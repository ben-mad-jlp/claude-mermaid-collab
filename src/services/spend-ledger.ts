/**
 * spend-ledger.ts — the ONE sink every LLM call funnels its token usage into, plus the burn gauge
 * and the leak alarm on top of it.
 *
 * Motivation: the daemon spends tokens from many places — leaf build nodes, conductor nodes, the Zen
 * summary interpreter, mission forge/planner nodes, the triage classifier (judgment-llm), digest,
 * consult_grok/consult-openai. Historically only the leaf executor recorded its usage, so every other
 * caller's spend was INVISIBLE — a leak (a pass re-spinning on an idle system) could burn tokens for
 * hours with nothing to see it. This module closes that: `recordSpend` is a single, best-effort,
 * source-tagged write over the existing `worker_ledger` (no new DB), and `getBurnBySource` /
 * `detectBurnLeaks` turn the ledger into a live burn gauge + an automatic leak detector.
 *
 * Enforcement posture (decision: default-on at the invoke boundary): `invokeNode`/`invokeGrokNode`
 * auto-record every call unless the caller opts out (the leaf executor opts out — it records richly
 * itself). Non-node LLM paths (judgment-llm, consult_*) call `recordSpend` directly. So a NEW spend
 * site is ledgered by default; you have to go out of your way to make one silent.
 */

import { recordNode, burnBySource, type SourceBurnRow } from './worker-ledger.ts';
import { estimateCostUsd, knownPricing, MODEL_PRICING } from '../agent/worker-core/cost.ts';

/** One LLM call's spend. Everything except project+source is best-effort — a call with no usage still
 *  records a row (calls++), which is exactly what makes an idle-system leak visible even when the
 *  subscription plan reports 0 cost and 0 tokens for a killed node. */
export interface SpendEvent {
  /** The project the call was made for (the tracking project). Required for per-project gauges. */
  project: string;
  /** Pass/caller tag — the GROUP BY key of the gauge: 'conductor' | 'summary' | 'triage' | 'forge' |
   *  'planner' | 'digest' | 'consult-grok' | 'consult-openai' | 'leaf' | 'node' | … */
  source: string;
  /** Node/phase kind for finer breakdown (defaults to `source`). */
  nodeKind?: string;
  provider?: string;
  model?: string;
  session?: string;
  /** Correlation id (missionId for conductor, leafId for leaf, session for summary, …). */
  todoId?: string;
  epicId?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    /** Provider-reported USD, if any. Omitted on the Max subscription → we estimate from tokens. */
    costUsd?: number;
    numTurns?: number;
  };
  durationMs?: number;
  rateLimited?: boolean;
  ok?: boolean;
}

/** Model-alias → published id so alias-named rows ('opus'/'sonnet'/…) still price. Full ids pass
 *  through. Kept tiny + local; the price table lives in worker-core/cost.ts. */
const MODEL_ALIAS: Record<string, string> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/** Resolve an alias/full id to a price-table key (best-effort). */
export function normalizeModelId(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (MODEL_PRICING[model]) return model;
  return MODEL_ALIAS[model] ?? model;
}

/**
 * Record one LLM call's spend. Best-effort: a DB hiccup never throws into the caller (an accounting
 * write must not break the thing it measures). costUsd is taken from the provider when present, else
 * estimated from tokens × the local price table so the Max-plan (costUsd omitted) still gets a USD
 * figure. Always writes a row — even zero-usage — so the CALL is counted.
 */
export function recordSpend(e: SpendEvent, now: number = Date.now()): void {
  try {
    const u = e.usage ?? {};
    const modelId = normalizeModelId(e.model);
    const providerCost = u.costUsd;
    const known = knownPricing(modelId);
    const costUsd =
      providerCost != null && providerCost > 0
        ? providerCost
        : estimateCostUsd(modelId, { inputTokens: u.inputTokens, outputTokens: u.outputTokens });
    recordNode(
      {
        project: e.project,
        todoId: e.todoId ?? e.source,
        epicId: e.epicId ?? null,
        session: e.session ?? 'daemon',
        phase: e.nodeKind ?? e.source,
        provider: e.provider ?? 'claude',
        model: e.model ?? '',
        source: e.source,
        nodeKind: e.nodeKind ?? e.source,
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        cacheCreationTokens: u.cacheCreationTokens ?? 0,
        costUsd,
        knownPrice: known || (providerCost != null && providerCost > 0),
        steps: u.numTurns ?? 0,
        nodesSpent: 1,
        durationMs: e.durationMs ?? null,
        rateLimited: e.rateLimited ?? null,
      },
      now,
    );
  } catch {
    /* accounting is best-effort — never break the measured call */
  }
}

/** A gauge row: the ledger's per-source aggregate plus an estimated USD (tokens × price) so the
 *  Max-plan's 0-cost rows still show an economic figure. */
export interface BurnRow extends SourceBurnRow {
  /** costUsd if the provider reported it, else Σ tokens×price across this source's rows. Because the
   *  aggregate loses per-row model, this estimate uses the source's dominant model when supplied via
   *  `modelHint`; otherwise it's the recorded costUsd (0 on Max). Primarily informational — `calls`
   *  and token totals are the load-bearing signal. */
  estCostUsd: number;
}

/** The burn gauge: per-source spend over a window. `sinceMs` is an absolute epoch-ms floor. */
export function getBurnBySource(opts: { project?: string; sinceMs?: number } = {}): BurnRow[] {
  const rows = burnBySource({ project: opts.project, since: opts.sinceMs });
  return rows.map((r) => ({
    ...r,
    // costUsd from the ledger is authoritative where present; otherwise leave the recorded value
    // (recordSpend already folded a token estimate into costUsd per row on write).
    estCostUsd: r.costUsd,
  }));
}

/** Per-source call-rate ceilings for the leak alarm. A source exceeding its ceiling within the
 *  window — with no offsetting productive work — is flagged. Deliberately generous defaults: this
 *  catches a RUNAWAY (a pass re-spinning every tick), not normal bursts. Tune via config later. */
export interface BurnThresholds {
  /** Max LLM calls per source within the window before it's a candidate leak. */
  maxCallsPerWindow: Record<string, number>;
  /** Fallback ceiling for a source not named above. */
  defaultMaxCalls: number;
}

export const DEFAULT_BURN_THRESHOLDS: BurnThresholds = {
  // A 60-min window. Conductor nodes are expensive + should be rare (one per real state change);
  // the summary interpreter is cheap but frequent; triage is capped at 3/tick.
  maxCallsPerWindow: {
    conductor: 8,
    summary: 60,
    triage: 40,
    forge: 6,
    planner: 12,
    digest: 12,
  },
  defaultMaxCalls: 60,
};

export interface BurnLeak {
  source: string;
  calls: number;
  ceiling: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  reason: string;
}

/**
 * PURE leak detector. Flags each source whose call count in the window exceeds its ceiling AND whose
 * work was NOT productive (a source in `productiveSources` is exempt — it burned, but it also moved
 * the work-graph, so it's spend, not a leak). Returns the flagged sources, worst-first.
 *
 * `productiveSources` is supplied by the caller from real signal (e.g. the leaf source is productive
 * when leaves were accepted this window; conductor is productive when a mission criterion advanced).
 * Leaving a source out of that set means "it burned with nothing to show" — the leak signature.
 */
export function detectBurnLeaks(
  rows: BurnRow[],
  opts: { thresholds?: BurnThresholds; productiveSources?: Set<string> } = {},
): BurnLeak[] {
  const thresholds = opts.thresholds ?? DEFAULT_BURN_THRESHOLDS;
  const productive = opts.productiveSources ?? new Set<string>();
  const leaks: BurnLeak[] = [];
  for (const r of rows) {
    const ceiling = thresholds.maxCallsPerWindow[r.source] ?? thresholds.defaultMaxCalls;
    if (r.calls <= ceiling) continue;
    if (productive.has(r.source)) continue; // burned but did real work — not a leak
    leaks.push({
      source: r.source,
      calls: r.calls,
      ceiling,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estCostUsd: r.estCostUsd,
      reason:
        `'${r.source}' made ${r.calls} LLM calls in the window (ceiling ${ceiling}) with no offsetting ` +
        `accepted work — a likely token leak (a pass re-spinning on an idle system).`,
    });
  }
  return leaks.sort((a, b) => b.calls / b.ceiling - a.calls / a.ceiling);
}
