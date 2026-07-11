# Pruned collab/* branches — recovery record (2026-06-09)

All clear wins were extracted to master before pruning:
- Cartographer engine P1a/P1b → cherry-picked (v5.85.18)
- getSecret config-first (Grok-key fix) → cherry-picked (v5.85.19)
- collab/integration features (Cartographer P1c, Vocab-3, Steward gate-split) → merged (v5.85.17)

22 fully-merged branches were safe-deleted earlier. The branches below held only
SUPERSEDED / UNMERGEABLE / UNCERTAIN work and were force-pruned. Every distinct
commit is recoverable by sha: `git cherry-pick <sha>` (also in reflog ~90 days).

## collab/backend-1-20260605-1619
- 8defecd `[SEAM] Pin/refresh bsync session against idle-GC` — build123d/bsync, UNASSESSED
- c6ba9c1 `[yolox A1] yolox-markup project.json manifest` — project file, not core
- 25b5f71 `BUG: MCP artifacts don't broadcast` — TEST-ONLY; already fixed in master
- 0c68883 `BUG: cross-project terminal wrong/empty` — ALREADY in master (ide-routes getSupervisedLaunchProject)
- f82383d `[Profile L4] Auto-proposer` — SUPERSEDED (master profile-* pipeline)
- 48f78b2 `[Profile L4d] APPROVE` — SUPERSEDED

## collab/backend-4-20260605-1721
- 28e9c4d `[Vocab 2] retire lane/pool-session` — largely landed (master uses poolName)
- 91c55c1 `[REFACTOR] setup.ts → handler registry` — UNMERGEABLE (master setup.ts diverged to 4930 lines); redo from scratch if wanted
- 15f9237 `getSecret config-first` — MERGED to master (v5.85.19)
- 8a24cd2 `BUG: Coordinator pill stale` — ALREADY in master (af49309a)
- 00d45b2 `[OBSERVABILITY] fleet visibility` — largely in master (spawnedSessions/fleet graph)
- 9b85d17 `[Profile L4b] tech-pack store` — SUPERSEDED (master registerPack/listPacks)

## collab/backend-2-20260605-2047
- f03d64a `[Readiness P3] Steward auto-createGate on needs-design/operator-gated` — UNCERTAIN (master has createGate primitive; auto-on-escalation wiring not confirmed). Recoverable if wanted.

## collab/backend-3-20260605-1623
- 2e493483 `[PERF] reduce worker warm-up cold-start` (claude-launch.ts) — UNCERTAIN (master has warm-pool machinery). Recoverable.
- 5b6272c `[Profile L4a] DETECT` — SUPERSEDED
- 3d0c0e6b `[Profile L4c] DRAFT` — SUPERSEDED

## Worktree-pinned (NOT pruned — need `git worktree remove` first; may be coordinator-active)
- collab/integration, collab/general-1-20260608-2140, collab/backend-3-20260606-1617,
  collab/backend-4-20260606-1657 — all MERGED (content in master)
- collab/backend-1-20260606-2210 — Cartographer P1a/P1b now in master (spent)
