# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 9
- **Total waves:** 4
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** orchestrator-config
**Wave 2:** build-pass, reconcile-pass, orchestrator-routes, route-escalations-human
**Wave 3:** orchestrator-daemon, ui-orchestrator-ladder
**Wave 4:** wire-boot, retire-role-sessions

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    orchestrator-config["orchestrator-config<br/>"OrchestratorLevel type + ORCH..."]
    build-pass["build-pass<br/>"Extract the per-project coord..."]
    reconcile-pass["reconcile-pass<br/>"Deterministic runReconcilePas..."]
    orchestrator-routes["orchestrator-routes<br/>"GET/POST /api/orchestrator/le..."]
    route-escalations-human["route-escalations-human<br/>"Phase 1: routeEscalation retu..."]
    orchestrator-daemon["orchestrator-daemon<br/>"Single always-on daemon: one ..."]
    wire-boot["wire-boot<br/>"Replace autoStartCoordinator-..."]
    retire-role-sessions["retire-role-sessions<br/>"Remove/neutralize Supervisor+..."]
    ui-orchestrator-ladder["ui-orchestrator-ladder<br/>"Per-project 5-stop segmented ..."]

     --> orchestrator-config
    orchestrator-config --> build-pass
    orchestrator-config --> reconcile-pass
    orchestrator-config --> orchestrator-routes
    orchestrator-config --> route-escalations-human
    orchestrator-config --> orchestrator-daemon
    build-pass --> orchestrator-daemon
    reconcile-pass --> orchestrator-daemon
    orchestrator-daemon --> wire-boot
    orchestrator-daemon --> retire-role-sessions
    route-escalations-human --> retire-role-sessions
    orchestrator-routes --> ui-orchestrator-ladder

    style orchestrator-config fill:#c8e6c9
    style build-pass fill:#bbdefb
    style reconcile-pass fill:#bbdefb
    style orchestrator-routes fill:#bbdefb
    style route-escalations-human fill:#bbdefb
    style orchestrator-daemon fill:#fff3e0
    style ui-orchestrator-ladder fill:#fff3e0
    style wire-boot fill:#f3e5f5
    style retire-role-sessions fill:#f3e5f5
```

## Tasks by Wave

### Wave 1

- **orchestrator-config**: "OrchestratorLevel type + ORCH_LEVELS + levelRank + persisted per-project get/set/default (default 'build'); migrate per-project coordinator on/off -> build/off."

### Wave 2

- **build-pass**: "Extract the per-project coordinator tick body into exported runBuildPass(project); make startCoordinator/timers/autoStartCoordinator orchestrator-driven shims (no self-scheduling). Claim/spawn/gate unchanged; existing tests green."
- **reconcile-pass**: "Deterministic runReconcilePass(project): nudge idle supervised sessions with ready work (rate-limited), auto-close stale escalations, surface verified-done. No LLM."
- **orchestrator-routes**: "GET/POST /api/orchestrator/level?project= and GET /api/orchestrator/health; wire into the router."
- **route-escalations-human**: "Phase 1: routeEscalation returns 'human' unconditionally (Grok triage not wired). Keep routeOf/verbs/proof-gate/isStewardArmed defined but dormant for Phase 2."

### Wave 3

- **orchestrator-daemon**: "Single always-on daemon: one tick that dispatches runBuildPass (>=build) + runReconcilePass (>=nudge) per project by level; per-project error isolation (fail-open); startOrchestrator/stopOrchestrator/orchestratorHealth."
- **ui-orchestrator-ladder**: "Per-project 5-stop segmented slider (off·build·nudge·propose·consult) bound to /api/orchestrator/level; remove the coordinator pill + steward/supervisor role cards (RoleConsoleCard/AutoToggle/RoleStartButton); add one daemon-health dot."

### Wave 4

- **wire-boot**: "Replace autoStartCoordinator-per-project boot with startOrchestrator(); the watchdog stall-scan rides the orchestrator tick."
- **retire-role-sessions**: "Remove/neutralize Supervisor+Steward SESSION spawn+lifecycle: role/stop, launch-session role paths, steward-identity/mode/enabled. Keep steward verbs + proof gate dormant. No session is spawned for these roles."
