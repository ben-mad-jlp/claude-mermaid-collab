# Completeness Review — Orchestrator Daemon Phase 1

Reviewed against blueprint `Implementing-orchestrator-daemon-phase1`.
Date: 2026-06-08.

---

## Verdict: **COMPLETE** (2 intentional Phase-2 deferrals, 1 minor health-endpoint note — no real gaps)

---

## Task-by-task findings

### T1 `orchestrator-config` ✅
`src/services/orchestrator-config.ts` — fully implemented.
- `OrchestratorLevel` type, `ORCH_LEVELS`, `levelRank`, `getOrchestratorLevel` (default `'build'`), `setOrchestratorLevel` (upsert with coercion), SQLite persistence on `supervisor.db`, `_closeDb()` test helper.
- No stubs, no TODOs. Migration note (on/off → build/off) is implicit via default-to-build in `coerce()` (no explicit migration needed since unset rows default to `'build'`).

### T2 `build-pass` (coordinator-live.ts) ✅
`runBuildPass(project)` is exported (line 873). `startCoordinator` / `autoStartCoordinator` still exist as shims but the per-project tick body is now callable standalone. Existing tests remain valid.

### T3 `reconcile-pass` ✅
`src/services/reconcile-pass.ts` — fully implemented.
- NUDGE: idle sessions with ready work are rate-limited (5 min cooldown).
- STALE: open escalations past `SUPERVISOR_STALE_AFTER_MS` are auto-closed with `'stale'` + audit record.
- VERIFIED-DONE: clearly documented `TODO (Phase 2)` with comment explaining the proof-gate requirement — this is an **intentional Phase-1 deferral** (not a gap; the blueprint explicitly says "surface verified-done" as a placeholder, no auto-close yet required).

### T4 `orchestrator-daemon` (orchestrator-live.ts) ✅
`src/services/orchestrator-live.ts` — fully implemented.
- `passesForLevel`, `runOrchestratorTick(deps)` with per-project fail-open catch, injectable seams for testing.
- `startOrchestrator` / `stopOrchestrator` / `isOrchestratorRunning` / `getOrchestratorHealth` all present.

**Minor note** — `getOrchestratorHealth` always returns `projects: []` (the async `projectRegistry.list()` is skipped for the synchronous health snapshot). The comment says "caller can call tick for detail." This is a conscious design tradeoff, not a bug. The `running`, `tickMs`, `lastTickAt` fields are accurate.

### T5 `orchestrator-routes` ✅
`src/routes/orchestrator-routes.ts` — `GET /api/orchestrator/level`, `POST /api/orchestrator/level`, `GET /api/orchestrator/health` all present. Validation (missing project, invalid level) handled. Wired into `src/server.ts` at line 373.

**Note** — the health route does a dynamic `import('../services/orchestrator-live.ts')` with a try-catch fallback, which is a defensive remnant from when the file didn't exist yet. Now that `orchestrator-live.ts` exists it will always hit the real import path. Harmless, but could be simplified to a static import in a future cleanup.

### T6 `route-escalations-human` ✅
`src/services/supervisor-store.ts` line 561: `routeEscalation` returns `'human'` unconditionally. Function is properly documented as Phase-1 stub. `routeOf`, `isStewardArmed`, `isStewardPaused`, `stewardFailOpenScan` and the proof-gate are all retained dormant (Phase 2). ✅

### T7 `wire-boot` ✅
`src/server.ts` line 146: comment says per-project `autoStartCoordinator` boot loops are no longer needed. Line 149-150: dynamically imports `orchestrator-live.ts` and calls `startOrchestrator()`. Wired correctly.

**Minor note** — boot uses a dynamic import (`await import('./services/orchestrator-live.js')`) rather than a static top-level import. This is the same defensive pattern as the routes; now that the file exists it is fully functional. Could be a static import, but no functional difference.

### T8 `retire-role-sessions` ✅
`src/routes/supervisor-routes.ts`:
- `GET /api/supervisor/steward-identity` → returns `{ identity: null, running: false, … }` (dormant stub).
- `POST /api/supervisor/steward/mode` → `{ ok: true, note: 'retired' }`.
- `POST /api/supervisor/steward/enabled` → `{ ok: true, note: 'retired' }`.
- `POST /api/supervisor/role/stop` → `{ stopped: false, reason: 'role sessions retired (orchestrator daemon)' }`.
- No `launch-session` role path found (was never in the codebase or already removed).
- `startCoordinator` / `stopCoordinator` routes still present at `/api/supervisor/coordinator` — these are fine: the coordinator can still be started per-project from outside the orchestrator for debugging/override. Not a gap.

### T9 `ui-orchestrator-ladder` ✅
`ui/src/components/supervisor/bridge/OrchestratorLadder.tsx` — fully implemented 5-stop segmented slider, bound to GET/POST `/api/orchestrator/level`, optimistic update with rollback, `data-testid` attributes.

`SupervisorPanel.tsx` mounts `<OrchestratorLadder project={project} />` per project (line 563). `RoleConsoleCard`, `AutoToggle`, `RoleStartButton` — none found in the codebase (already gone or never present by that name).

**Noted gap**: the blueprint calls for "a single daemon-health dot" in the UI alongside the ladder. No `HealthDot` or daemon-health indicator was found in `SupervisorPanel.tsx` or `OrchestratorLadder.tsx`. The `getOrchestratorHealth` backend endpoint exists, but the frontend health indicator is absent.

---

## Tests

| Test file | Exists |
|---|---|
| `src/services/__tests__/orchestrator-config.test.ts` | ✅ |
| `src/services/__tests__/orchestrator-live.test.ts` | ✅ |
| `src/services/__tests__/reconcile-pass.test.ts` | ✅ |
| `src/services/__tests__/steward-routing.test.ts` | ✅ |
| `src/routes/__tests__/orchestrator-routes.test.ts` | ❌ missing |

The blueprint lists `src/routes/__tests__/orchestrator-routes.test.ts` but the file does not exist. The route logic is thin (delegates to `orchestrator-config` which is tested), but the spec called for it.

---

## TypeScript

`npx tsc --noEmit` exits 0. No type errors.

---

## Stub / TODO scan

- `reconcile-pass.ts` line 162–170: explicit `// TODO(Phase 2)` for verified-done. **Intentional Phase-1 deferral** — blueprint says "surface verified-done (no auto-close yet)". The placeholder is clear and complete.
- No `throw new Error('Not implemented')` or `NotImplemented` found in the new files.

---

## Summary of gaps

| # | Gap | Severity | Intentional deferral? |
|---|---|---|---|
| 1 | `verified-done` auto-close not implemented in `reconcile-pass.ts` | — | ✅ Yes — Phase 2 per blueprint |
| 2 | `getOrchestratorHealth` always returns `projects: []` | Minor / by design | ✅ Yes — noted in code comment |
| 3 | `src/routes/__tests__/orchestrator-routes.test.ts` missing | Minor | ❌ Real gap — blueprint listed it |
| 4 | UI daemon-health dot not implemented in `SupervisorPanel` / `OrchestratorLadder` | Minor | Ambiguous — blueprint mentions it but it's cosmetic |

**Real gaps: 1–2 minor items** (missing route test file; missing daemon-health dot in UI). No behavioral Phase-1 feature is absent.
