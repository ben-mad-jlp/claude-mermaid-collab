# Consult + synthesis — config-driven tier matrix (#3, 2026-06-15)

Built as commit `7a34151` (deployed). This records the design fork and why it landed where it did.

## The decision
Make the hard-coded phase→provider routing (`providerForPhase`: judgment→claude, implement→grok)
CONFIGURABLE. My initial plan was a single `WORKER_TIER_MATRIX` JSON-blob config key with a 3-tier
resolution order (byLevel → byPhase → hard-coded default).

## Grok skeptical review (grok-4.3), ranked
1. **JSON blob is the wrong primitive** for a local single-user tool — hostile to edit, ugly diffs,
   runtime-only validation. The existing `JUDGMENT_PROVIDER` precedent (flat string keys + safe
   defaults) is better.
2. **`byLevel` is premature** — no evidence anyone needs per-autonomy-level routing; it adds a map
   dimension + resolver complexity + test surface for a scenario that doesn't exist.
3. **Layered resolution + silent fallbacks = opacity** — user won't know *why* a phase picked a model;
   add a visible decision trail.
4. **Minor:** `codex→false` means the matrix can never usefully name codex without an unconditional
   fallback; availability check happens post-resolution (removing a key silently re-routes next run).
- Simpler alternative: keep `providerForPhase`, add a few optional string override keys. Tiny delta.

## Synthesis (ACCEPT / TEMPER / DISCOUNT)
- **ACCEPT #1** — flat string keys: `WORKER_PROVIDER_<PHASE>` + optional `WORKER_MODEL_<PHASE>`,
  mirroring `JUDGMENT_PROVIDER`. config-service native (strings), Secrets-UI editable, no JSON parse.
- **ACCEPT #2** — dropped `byLevel`. The north-star's "escalate review at drive" is an explicit
  evidence-gated future step; build phase-level now, add a level dimension when a concrete case lands.
- **TEMPER #3** — the per-phase transcript already renders the chosen model (`▶ role (model)`), so
  routing IS visible; declined to add log noise. (Follow-up if needed: surface WHICH config key chose it.)
- **ACCEPT #4** — fallback target improved: a configured-but-unavailable/unknown override falls through
  to the DEFAULT tier (`providerForPhase`), not the raw base — strictly smarter (override implement=claude
  with no anthropic key → still grok, not whatever base is). codex always falls through (unwired). Commented.

## What shipped
- `resolve-model.ts`: `PROVIDER_IDS`, `providerAvailable(provider)` (claude→anthropicAvailable,
  grok-build→grokAvailable, codex→false).
- `coordinator-bridge.ts`: `resolveTierRoute(phase, base)` layered over `providerForPhase`; the
  `resolveModel` dep uses it. Override wins only if set AND available; else default tier.
- `tier-routing.test.ts`: 90 worker-core tests pass (override wins, model pin, keyless/unwired ignored,
  unknown-string ignored, byte-identical when unset).

## Open follow-ups (north-star §2, §6)
- Per-autonomy-level routing (deferred above) — when there's a concrete need.
- Per-PROJECT tier config (today these are GLOBAL config keys, like JUDGMENT_PROVIDER). Fine for
  single-user; revisit if multiple projects want divergent tiers.
- Routing-decision visibility: show the config-cell/source in the transcript ("why this model").
- Measure the tier cells empirically (the bakeoff harness) to fill evidence-based defaults.
