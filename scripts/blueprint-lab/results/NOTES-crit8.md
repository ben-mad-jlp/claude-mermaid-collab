# crit_8 measurement — interpretation & caveats (2026-07-29)

Run: 77-case corpus, blueprint model=sonnet effort=medium, concurrency 8, harness at
master e8d80f61 (with the stdin-retry + resumability fix). GATE VERDICT: **ESCALATE**
(acceptRate 0.0% < 70%). Named next-redesign emitted: **prose+normalize fallback**.

## Read the 0% with two caveats — it is NOT a clean 48.1% → 0% model collapse

1. **The scorer got materially STRICTER since the crit_7 baseline (7f473bf8).** A new
   `missing:symbol-present` rejection mode appears at **40.3%** this run vs **0.0%** at
   baseline — it is the §4 `validateContractForKind` strictness matrix that THIS mission
   built (cases c2e6f88f / f60d57d5). Every parsed contract now also has to name the
   symbols it touches. So `acceptRate=0.0%` is measured against a HARDER gate than the
   48.1% baseline — the two accept numbers are not apples-to-apples. A re-baseline of
   crit_7 under the current scorer is owed before treating the delta as a regression.

2. **Some parse-nulls are infra load, not model failure.** parse-null jumped
   7.8% → **45.5%**. Much is genuine (the primary node often does not emit a parseable
   v2 fence — crit_8's real problem), but a tail cluster of cases failed at a uniform
   ~190–205s under 8-way concurrency: account rate-cap / node timeout, which returns an
   empty result → parse-null. Those are harness-load artifacts. The resumable harness can
   re-run ONLY the 35 unparsed ids on a quiet account to separate genuine-null from
   capped-null: `bun run scripts/blueprint-lab/run.ts` reuses the 42 valid emits.

## What survives both caveats (the honest signal)

- Even discounting infra-null, typed-contract emission at sonnet/medium is **not reliable
  enough to gate on** — mean file-match rate 65.0%, leafKind mismatches 19/77, and a large
  genuine parse-null share. This confirms the mission memo's finding that activation must
  lean on a repair/fallback path, not a bare flip.
- The named redesign — **prose+normalize fallback** (primary node authors free-text first;
  a fallback pass normalizes prose into the v2 shape when no parseable fence is emitted) —
  is the right next step regardless of the caveats: it directly attacks the dominant
  parse-null mode without betting on the primary node emitting perfect JSON.

## Follow-ups (not blockers to committing this measurement)

- Re-baseline crit_7 under the CURRENT scorer, then re-compare.
- Clean re-run of the 35 unparsed ids on a quiet (uncapped) account to quantify the
  genuine-null vs capped-null split.
