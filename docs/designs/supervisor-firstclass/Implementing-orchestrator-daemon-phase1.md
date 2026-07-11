# Blueprint: Unified Orchestrator Daemon — Phase 1 (unify the shell, no Grok)

## Source Artifacts
- `design-unified-orchestrator-daemon` (design)
- decision `f0ec0b06` (supersedes `eb3c3e60`)

## Scope (Phase 1 only)
One always-on **Orchestrator** daemon + a per-project **level** ladder `off·build·nudge·propose·consult`. Wire `off`/`build`/`nudge` for real; `propose`/`consult` are selectable but behave as **all-escalations→human** until Phase 2 (Grok). Map today's **Coordinator** to the `build` pass; port the **Supervisor reconcile** loop to a deterministic `nudge` pass; **retire the Steward + Supervisor Claude-Code sessions** and their spawn/heartbeat/epoch machinery (keep the steward verbs + proof gate dormant for Phase 2). Replace the Bridge coordinator pill + steward/supervisor cards with one per-project 5-stop slider.

---

## 1. Structure Summary

### Files
- [ ] `src/services/orchestrator-config.ts` — NEW. `OrchestratorLevel` type + persisted per-project level (get/set/default), built on the existing config store.
- [ ] `src/services/coordinator-live.ts` — MODIFY. Extract the per-project tick body into an exported `runBuildPass(project)`; stop self-scheduling (`startCoordinator`/timers/`autoStartCoordinator` become orchestrator-driven shims). Claim/spawn/gate logic unchanged.
- [ ] `src/services/reconcile-pass.ts` — NEW. Deterministic `runReconcilePass(project)`: nudge idle supervised sessions with ready work; auto-close `stale` escalations; surface `verified-done`.
- [ ] `src/services/orchestrator.ts` — NEW. The single always-on daemon: one `setInterval` tick that, per registered project, dispatches passes by level. `startOrchestrator()`/`stopOrchestrator()`/`orchestratorHealth()`.
- [ ] `src/services/supervisor-store.ts` — MODIFY. `routeEscalation` returns `'human'` unconditionally in Phase 1 (Grok triage not yet wired); keep `routeOf`/verbs/proof-gate/`isStewardArmed` defined but dormant.
- [ ] `src/routes/orchestrator-routes.ts` — NEW. `GET/POST /api/orchestrator/level?project=` + `GET /api/orchestrator/health`.
- [ ] `src/routes/supervisor-routes.ts` — MODIFY. Remove/neutralize role spawn+lifecycle for `supervisor`/`steward` (`role/stop`, the `launch-session` role paths, `steward-identity`/`steward/mode`/`steward/enabled`) — dormant, not load-bearing.
- [ ] `src/server.ts` — MODIFY. Replace `autoStartCoordinator`-per-project boot with `startOrchestrator()`.
- [ ] `ui/src/components/supervisor/bridge/OrchestratorLadder.tsx` — NEW. 5-stop segmented slider per project, bound to `/api/orchestrator/level`.
- [ ] `ui/src/components/supervisor/bridge/GlobalRoleSwitches.tsx` / `ui/src/components/layout/SupervisorPanel.tsx` — MODIFY. Drop the coordinator pill + the steward/supervisor `RoleConsoleCard`/`AutoToggle`/`RoleStartButton`; mount the per-project ladder + a single daemon-health dot.

### Type Definitions
```ts
export type OrchestratorLevel = 'off' | 'build' | 'nudge' | 'propose' | 'consult';
export const ORCH_LEVELS: OrchestratorLevel[] = ['off','build','nudge','propose','consult'];
// numeric rank so a pass can gate on `rank(level) >= rank('build')`
export function levelRank(l: OrchestratorLevel): number; // off=0 … consult=4
```

### Component Interactions
`startOrchestrator()` (boot) → one tick loop → for each registered project: read `getOrchestratorLevel(project)` → if `≥build` `runBuildPass(project)` (was the coordinator tick); if `≥nudge` `runReconcilePass(project)`; `propose`/`consult` → no-op in P1 (escalations already route to human via `routeEscalation`). UI ladder POSTs the level; the daemon picks it up next tick.

---

## 2. Function Blueprints

### `runBuildPass(project: string): Promise<void>` (coordinator-live.ts)
**Pseudocode:** the exact body currently inside `startCoordinator`'s `setInterval` (claim ready → launchWorker → reap dead claims → gate). No behavior change; just callable.
**Edge cases:** must stay re-entrant-safe (skip if a prior pass for this project is still running — reuse the existing in-flight guards). **Test:** existing coordinator-live tests still green; a project below `build` never claims.

### `runReconcilePass(project: string): Promise<void>` (reconcile-pass.ts)
**Pseudocode:** 1) list supervised sessions for `project`; 2) for each idle session whose owned todos include a `ready` one → send the existing nudge (reuse `/api/supervisor/nudge` path / `sendTmuxKeys`), rate-limited per session; 3) `stale` escalations (open + past staleness window) → auto-close (audit `reconcile`); 4) `verified-done` candidates → surface (no auto-close yet). Deterministic only — NO LLM.
**Edge cases:** never nudge a session with no ready work; dedupe nudges (cooldown). **Test:** idle+ready → nudged; idle+no-ready → not; stale escalation closed; runs only at `≥nudge`.

### `tick(): Promise<void>` (orchestrator.ts)
**Pseudocode:** for `p` in registeredProjects: `lvl=getOrchestratorLevel(p)`; if `lvl==='off'` continue; if `rank(lvl)>=rank('build')` `await runBuildPass(p)`; if `rank(lvl)>=rank('nudge')` `await runReconcilePass(p)`. Catch per-project errors so one project can't wedge the tick (fail-open).
**Edge cases:** a triage/reconcile failure MUST NOT block the build pass. **Test:** dispatch table by level; one throwing project doesn't stop others.

### `getOrchestratorLevel / setOrchestratorLevel(project, level)` (orchestrator-config.ts)
Persist per-project (reuse the durable per-project config store the watched-set/coordinator already use). Default `build` for a freshly-registered project (preserves today's "coordinator auto-starts" behavior); migrate existing per-project coordinator on/off → `build`/`off`.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: orchestrator-config
    files: [src/services/orchestrator-config.ts]
    tests: [src/services/__tests__/orchestrator-config.test.ts]
    description: "OrchestratorLevel type + ORCH_LEVELS + levelRank + persisted per-project get/set/default (default 'build'); migrate per-project coordinator on/off -> build/off."
    parallel: true
    depends-on: []
  - id: build-pass
    files: [src/services/coordinator-live.ts]
    tests: [src/services/__tests__/coordinator-live.test.ts]
    description: "Extract the per-project coordinator tick body into exported runBuildPass(project); make startCoordinator/timers/autoStartCoordinator orchestrator-driven shims (no self-scheduling). Claim/spawn/gate unchanged; existing tests green."
    parallel: true
    depends-on: [orchestrator-config]
  - id: reconcile-pass
    files: [src/services/reconcile-pass.ts]
    tests: [src/services/__tests__/reconcile-pass.test.ts]
    description: "Deterministic runReconcilePass(project): nudge idle supervised sessions with ready work (rate-limited), auto-close stale escalations, surface verified-done. No LLM."
    parallel: true
    depends-on: [orchestrator-config]
  - id: orchestrator-routes
    files: [src/routes/orchestrator-routes.ts]
    tests: [src/routes/__tests__/orchestrator-routes.test.ts]
    description: "GET/POST /api/orchestrator/level?project= and GET /api/orchestrator/health; wire into the router."
    parallel: true
    depends-on: [orchestrator-config]
  - id: route-escalations-human
    files: [src/services/supervisor-store.ts]
    tests: [src/services/__tests__/steward-routing.test.ts]
    description: "Phase 1: routeEscalation returns 'human' unconditionally (Grok triage not wired). Keep routeOf/verbs/proof-gate/isStewardArmed defined but dormant for Phase 2."
    parallel: true
    depends-on: [orchestrator-config]
  - id: orchestrator-daemon
    files: [src/services/orchestrator.ts]
    tests: [src/services/__tests__/orchestrator.test.ts]
    description: "Single always-on daemon: one tick that dispatches runBuildPass (>=build) + runReconcilePass (>=nudge) per project by level; per-project error isolation (fail-open); startOrchestrator/stopOrchestrator/orchestratorHealth."
    parallel: false
    depends-on: [orchestrator-config, build-pass, reconcile-pass]
  - id: wire-boot
    files: [src/server.ts]
    tests: []
    description: "Replace autoStartCoordinator-per-project boot with startOrchestrator(); the watchdog stall-scan rides the orchestrator tick."
    parallel: false
    depends-on: [orchestrator-daemon]
  - id: retire-role-sessions
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/__tests__/supervisor-routes.test.ts]
    description: "Remove/neutralize Supervisor+Steward SESSION spawn+lifecycle: role/stop, launch-session role paths, steward-identity/mode/enabled. Keep steward verbs + proof gate dormant. No session is spawned for these roles."
    parallel: false
    depends-on: [orchestrator-daemon, route-escalations-human]
  - id: ui-orchestrator-ladder
    files: [ui/src/components/supervisor/bridge/OrchestratorLadder.tsx, ui/src/components/supervisor/bridge/GlobalRoleSwitches.tsx, ui/src/components/layout/SupervisorPanel.tsx]
    tests: []
    description: "Per-project 5-stop segmented slider (off·build·nudge·propose·consult) bound to /api/orchestrator/level; remove the coordinator pill + steward/supervisor role cards (RoleConsoleCard/AutoToggle/RoleStartButton); add one daemon-health dot."
    parallel: false
    depends-on: [orchestrator-routes]
```

### Execution Waves

**Wave 1 (parallel):** `orchestrator-config`

**Wave 2 (parallel, dep config):** `build-pass`, `reconcile-pass`, `orchestrator-routes`, `route-escalations-human`

**Wave 3:** `orchestrator-daemon` (deps config + build-pass + reconcile-pass)

**Wave 4 (parallel):** `wire-boot`, `retire-role-sessions`, `ui-orchestrator-ladder`

### Summary
- Total tasks: 9
- Total waves: 4
- Max parallelism: 4
- Acceptance gate (all): `npx tsc --noEmit` + the project test suite green; manual smoke (a project at `build` claims ready todos as today; at `off` it doesn't; at `nudge` an idle+ready session is nudged; no supervisor/steward session is ever spawned).
- NOTE (build here, not the Coordinator): these tasks modify the daemon/coordinator itself — execute via `/vibe-go` under this session's control, NOT autonomous coordinator workers (a worker would rebuild its own spawn machinery mid-flight).
