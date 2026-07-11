# Overnight landing — 2026-06-15 (supervisor, while user slept)

User directive: "push everything through besides the Windows/Ubuntu ports and the yolox things — get it through and land tonight."

## LANDED + DEPLOYED (live v5.101.11, sidecar PID 27577 on :9002, drift=false)
Brake held: `claude-mermaid-collab` orchestrator level = **off** (steward brake, one-way — raise via Bridge ladder, human-only). Single deploy at end via `scripts/deploy-desktop.sh` (backups: mc-server.bak-1781521992 / ui/dist.bak-1781521992).

- **Audio UI** `28fe3b34` — wired audio artifact type through frontend (commit 7b8f332). tsc clean. accepted (steward override — gate was blind to a trailer-less master commit).
- **Game audio toolkit** epic `ad608533` + LAND `3637bca7` — done.
- **Game asset toolkit** epic `8584e713` + LAND `a2cf6408` — done. Palette `1a92cd75` finalized via steward override (was stranded pending).
- **Image-gen** epic `eb7ca492` — done (only open child 604b5b8f image→3D is deliberately DEFERRED/backlog, 2D-focus).
- **grok-game-mcp** `419e78f4` — verified clean + tsc-clean in its own repo (~/Code/grok-game-mcp HEAD ea1c830), marked done.

## DAEMON RELIABILITY BUGS (epic 9759e36f) — the keystone for unattended landing
Fixed 3 of 4 (commits 7ab8d6c + 58331d5, deployed). These now also benefit the 5 OTHER projects driving overnight (build123d, stud_feeder, terminator, qbs, figure-h8).
- ✅ `7fb16985` status-reconcile — module-identity bug: orchestrator_status imported `orchestrator-live.ts` while server/system-status import `.js` → 2 module records w/ separate daemon state. Unified to `.js` + static binding. PROVEN LIVE (both read-models now agree running:true). status-reconciliation.test.ts 4/4.
- ✅ `c4f9f170` reclaim→ready — un-completing a done todo now → `ready` (was `todo`, which stranded committed work). todo-store 73/73.
- ✅ `7b7d66d5`(b)+(c) acceptance false-reject — verifyWorkCommitted now falls back to commitOnIntegration before declaring a "hallucination", so master-landed work isn't false-rejected. (c) accept-time reversal already master-aware via OI-1. Residual (a): drive doesn't actively finalize an already-stuck done+pending (now rare since acceptances no longer go falsely pending) + a git-fixture test — minor follow-up.
- ⏸️ `6e17aaac` pool-per-project — **DEFERRED** (planned). Only bites with MULTIPLE drive projects (it does tonight — 5 driving share one global pool, so they build slower-but-not-broken). NOT fixed because worker-pool.ts has 4 pre-existing test failures (fragile, under-tested) and a bad fix could WEDGE the whole fleet overnight — contention degrades gracefully, a broken claim path does not. TOP next-session bug.

## NOT BUILT (genuine multi-session feature work — deliberately NOT auto-built unattended onto the daily-driver app)
Both got a `[LAND]` leaf added to clear stranded-epic invariants.
- `98951efb` **Epic landing P2–P4** (design-epic-landing) — only P1 built previously. P2 (lift land-card mute), P3 (real LAND button), P4 (EPIC_LAND_CAP tuning) unbuilt.
- `d3e2a341` **User (human) todos** — assigneeKind field already exists in the model; remaining = Coordinator SKIPS claiming human todos + human inbox view (design Layer B).
Rationale: keystone orchestrator changes; building half-correct versions unattended risks destabilizing the orchestrator the user relies on daily. Better as design-driven next-session work.

## STATE FOR RESUME
- git: master = origin/master = 9b1735a; tags v5.101.10, v5.101.11 pushed; tree clean.
- Supervisor: RESUMED (global, watches the 5 driving projects overnight).
- Orchestrator: claude-mermaid-collab = off; build123d/stud_feeder/terminator/qbs/figure-h8 = drive.
- Invariants: 4 violations — 3 are the EXCLUDED epics (yolox/Windows/Ubuntu, expected no-LAND); audio epic-planned-ready-child cleared by accepting 28fe3b34.
- Escalations: ~5 open, all OTHER projects (2 yolox=excluded, 2 /tmp throwaways, +1 from restart) — none block this project.
- Excluded per directive (untouched): Windows `68affdb7`, Ubuntu `7d860a50`, yolox `821008df`.

## NEXT SESSION
1. Functional human-gate verification on the deployed app: audio chain (TTS+DSP+sfxr+chiptune) & a sprite/VFX asset; confirm new audio/asset MCP tools register in a FRESH Claude session.
2. Fix `6e17aaac` pool-per-project (carefully — fix the 4 pre-existing worker-pool test failures too).
3. Build the two feature epics (Epic-landing P2–P4, User-todos) with design decomposition.
4. Re-raise claude-mermaid-collab to drive (Bridge ladder) when you want the daemon back on this project.
