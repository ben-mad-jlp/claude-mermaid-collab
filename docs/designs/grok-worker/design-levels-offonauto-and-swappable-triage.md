# Design: collapse orchestrator levels to off/on/auto + make triage a swappable tier-matrix role

Status: APPROVED direction, NOT yet built (held epic). Decided with the human 2026-06-18.

## Vision
Two changes that simplify the autonomy model and unify how the escalation-triage model is chosen with how worker models are chosen.

1. **Levels off · build · nudge · propose · drive → off · on · auto.** Two of the five rungs are vestigial; collapse them.
2. **Triage = a swappable plugin via the SAME device as workers** — a `triage` role in the tier matrix, swappable per-scope from the TieringEditor (so grok-build → opus is one config change in one place).

## Ground truth (current behavior, verified in code)

Per-level incremental behavior today:
- **off** (`orchestrator-live.ts:146` `if (lvl==='off') continue`): daemon skips the project.
- **build**: `runBuildPass` — claim ready → spawn → mechanical gate, lease/orphan reaping, exhaust-escalate. The real worker loop.
- **nudge**: `runReconcilePass` — (a) tmux-nudge idle sessions that own ready work (`reconcile-pass.ts:119 sendTmuxKeys`), (b) auto-close stale escalations, (c) epic-rollup sweep + surface "ready to land" card.
- **propose**: `runTriagePass` — Grok classifies open escalations, writes `suggestedAction` inline; human confirms (`triage: rank>=propose`).
- **drive**: + `runDriveLandPass` (auto-land green epics, ≤2/tick) + auto-resolve high-conf suggestions (verb!=null, conf≥0.9, ≤2/tick, proof-gated) + the ONLY level where `bp1FilterStrandedFoundations` + `acceptTimeAncestorGate` (OI-1) reachability gates run.

Key findings that shape the design:
- **The tmux-nudge is DEAD in a headless world** — headless leaf-executor workers have NO tmux session to nudge. Only the reconcile's stale-escalation-close + land-surface remain useful.
- **Triage is ALREADY provider/model swappable by config — not hardcoded to Grok.** `grok-triage.ts:119 defaultCallGrok` → `makeJudgmentLLM(getJudgmentConfig()).complete()`. `getJudgmentConfig()` (`config-service.ts:120`) reads `JUDGMENT_PROVIDER` (xai|openai|anthropic) + `JUDGMENT_MODEL`; `makeJudgmentLLM` (`judgment-llm.ts:88`) has xAI/OpenAI/Anthropic impls. Opus today = `JUDGMENT_PROVIDER=anthropic` + `JUDGMENT_MODEL=claude-opus-4-8` (zero code).
- **Drive's auto-resolve is NARROW**: only the `now-buildable → reset_todo` verb at conf≥0.9. It does NOT broadly decide/resolve escalations.

The worker model-routing DEVICE (what we reuse for triage):
- `resolve-model.ts:63 resolveModel(provider, modelId)` — constructs the provider SDK.
- `coordinator-bridge.ts:53 providerForPhase(phase, base)` + JUDGMENT_PHASES — default tier (judgment→claude, implement→grok-build).
- `coordinator-bridge.ts:84 resolveTierRoute(phase, base, ctx)` — scoped override walk: epic > project > level > global `WORKER_PROVIDER_<PHASE>`/`WORKER_MODEL_<PHASE>` > default.
- `tier-override-store.ts:60 getTierOverride(scope, scopeId, phase)` — durable per-scope overrides (the TieringEditor's backing store).
- Asymmetry to bridge: workers resolve to a Vercel-AI-SDK `LanguageModel`; triage uses the hand-rolled `JudgmentLLM` fetch port. Both swap by config; they don't share one abstraction.

## Target design

### A. Levels → off / on / auto
- **off** = off (unchanged).
- **on** = build + reconcile(minus tmux-nudge) + **always-on Grok-suggest** (write-only; human confirms). Folds today's build+nudge+propose. The human-supervised mode: it works, surfaces land cards, closes stale escalations, and annotates every escalation with a suggested action — but never acts unattended.
- **auto** = on + auto-land + auto-resolve + the bp1/OI-1 reachability gates. Folds today's drive. The "act for me" mode.

Deletions/changes:
- **Delete the tmux-nudge** entirely (dead for headless). Keep reconcile's stale-escalation-close + epic-land-surface, now running at `on`.
- **Grok-suggest becomes always-on at `on`** (drop the `rank>=propose` gate on writing `suggestedAction`). Single-shot, cheap, human-confirmed.
- Reachability gates (bp1/OI-1), auto-land, auto-resolve stay gated to `auto` (they only matter when acting unattended).

Enum/migration: keep the internal level type able to read legacy values; map `build|nudge|propose → on`, `drive → auto`, `off → off` on read + a one-shot backfill of `orchestrator_config`. UI ladder becomes 3 rungs (off/on/auto).

### B. Triage as a tier-matrix role (the "same device")
- Add `triage` to the phase set in `coordinator-bridge.ts` (`PHASE_CONFIG_SUFFIX: triage → 'TRIAGE'`).
- Triage's model resolves via `resolveTierRoute('triage', base, { project, epicId? })` — same epic>project>level>global>default walk as worker phases, same `tier_override` store, same TieringEditor UI.
- Keep the `JudgmentLLM` port as the call surface (it already supports anthropic/openai/xai); feed it the provider+model `resolveTierRoute` returns instead of the flat `JUDGMENT_*` keys. (Optionally keep `JUDGMENT_*` as the global-tier fallback so nothing breaks.)
- Rename the misleading `callGrok`/`defaultCallGrok`/`grok-triage.ts` → `triage`/`classify` (provider-neutral) — naming only, but it stops implying grok.
- TieringEditor gains a `triage` row so the user swaps grok-build → opus per project/epic from one place.

Net: triage becomes a first-class swappable role on the same device as workers + orchestrators, exactly as requested ("maybe we want opus instead of grok-build … swappable").

## Staged migration (each independently shippable)
- **L1** — Internal level coalescing: add `coalesceLevel(raw)` mapping legacy→{off,on,auto}; route every `levelRank`/gate read through it. Behavior-neutral (build/nudge/propose all already ran the lower passes; the change is that `on` now ALSO runs triage write-only). Backfill `orchestrator_config` (build|nudge|propose→on, drive→auto).
- **L2** — Always-on Grok-suggest: drop the `rank>=propose` gate on `runTriagePass`'s suggestion WRITE; keep auto-resolve gated to `auto`. (After L1 this is "triage runs at on+".)
- **L3** — Delete the tmux-nudge path in `reconcile-pass.ts` (dead for headless); keep stale-close + land-surface. Remove the per-session nudge cooldown map.
- **L4** — Triage tier-role: add `triage` phase to coordinator-bridge + PHASE_CONFIG_SUFFIX; resolve triage model via `resolveTierRoute('triage', …)`; feed result into `makeJudgmentLLM`. Keep `JUDGMENT_*` as global fallback. Rename grok-triage→triage (provider-neutral).
- **L5** — UI: collapse the OrchestratorLadder to off/on/auto (3 rungs) + map labels; add a `triage` row to TieringEditor. (ui/ is Bun-managed — `bun add`, never npm install.)
- **L6** — Docs/skill: update planner SKILL.md + any level references (build/nudge/propose/drive) to off/on/auto; note triage is a tier role.
- **[LAND]** → master (human, dependsOn L1–L6).

## Risks / decisions
- **Behavior shift at `on`**: today `build` does NOT run triage; under the new `on` it does (write-only). That's the intended "suggestions always happen," but it means more Grok calls at the supervised level — acceptable (single-shot, cheap, human-confirmed), but call it out in L2 soak.
- **Auto-resolve scope unchanged** (narrow now-buildable). Expanding what `auto` decides is a SEPARATE future decision, explicitly out of scope here.
- **Don't break the flat `JUDGMENT_*` config** — keep it as the global-tier fallback so existing setups (and the zero-code opus swap) keep working.
- Legacy level values must keep reading correctly until the backfill + all readers migrate (coalesceLevel is the seam).

## Deferred (named, not built)
- Full unification of the two model-resolution abstractions (`resolveModel`→LanguageModel vs `makeJudgmentLLM`→JudgmentLLM) into one `resolveLLM(role, ctx)`. Not needed for swappability; nice cleanup later.
- Broadening `auto`'s auto-resolve beyond the single `now-buildable` verb.
