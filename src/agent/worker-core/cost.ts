/**
 * Model-call cost ledger (north-star §6, Tier-2) — turns token usage into USD.
 *
 * Prices are USD per 1,000,000 tokens. Anthropic prices are the published list
 * rates; grok-build is a PLACEHOLDER pending the real xAI rate. Treat unknown
 * models as cost 0 + `knownPricing=false` so a missing entry is visible, never a
 * silent $0. Update MODEL_PRICING when rates change (or load it from config later).
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // ⚠️ PLACEHOLDER — verify against current xAI pricing before trusting grok costs.
  'grok-build-0.1': { inputPerMTok: 0.2, outputPerMTok: 0.5 },
  // Anthropic published list rates (USD / 1M tokens).
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
};

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** True when we have a price for this model (so a 0 cost means "free/zero", not "unknown"). */
export function knownPricing(modelId: string | undefined): boolean {
  return !!(modelId && MODEL_PRICING[modelId]);
}

/** Estimated USD cost for one model call's usage. Unknown model → 0. */
export function estimateCostUsd(modelId: string | undefined, u: TokenUsage): number {
  const p = modelId ? MODEL_PRICING[modelId] : undefined;
  if (!p) return 0;
  const input = (u.inputTokens ?? 0) * p.inputPerMTok;
  const output = (u.outputTokens ?? 0) * p.outputPerMTok;
  return (input + output) / 1_000_000;
}

/** A running per-run cost ledger an adapter accumulates from phase-end events. */
export interface CostLedger {
  totalUsd: number;
  byModel: Record<string, { inputTokens: number; outputTokens: number; usd: number; unknownPrice?: boolean }>;
}

export function newCostLedger(): CostLedger {
  return { totalUsd: 0, byModel: {} };
}

/** Fold one model call's usage into the ledger. */
export function addToLedger(ledger: CostLedger, modelId: string | undefined, u: TokenUsage): void {
  const key = modelId ?? '(unknown)';
  const usd = estimateCostUsd(modelId, u);
  const row = (ledger.byModel[key] ??= { inputTokens: 0, outputTokens: 0, usd: 0 });
  row.inputTokens += u.inputTokens ?? 0;
  row.outputTokens += u.outputTokens ?? 0;
  row.usd += usd;
  if (!knownPricing(modelId)) row.unknownPrice = true;
  ledger.totalUsd += usd;
}
