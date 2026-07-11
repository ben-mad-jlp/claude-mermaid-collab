# Wave 1 Implementation

## Tasks
- **esc-store** (`src/services/supervisor-store.ts`): Added `ESCALATION_KINDS` const + `EscalationKind` type after the `Escalation` interface; added `listEscalations(status?)` (status→`WHERE status=? ORDER BY createdAt DESC`, else all DESC). Left `listOpenEscalations()` untouched (ASC). No existing behavior changed.
- **roadmap-waves** (`src/services/roadmap-store.ts`): Appended pure `computeWaves(items: RoadmapItem[]): RoadmapItem[][]` — Kahn layering, ignores unknown/dropped deps, cycle/self-dep safe (emits remainder as final wave), empty→[]. No db access.

## Verification
- supervisor-store.ts: verify STATUS done — all three points satisfied, tsc clean.
- roadmap-store.ts: verify STATUS done — signature/type correct, terminates on cycles, pure, tsc clean.

## Wave TSC
clean (exit 0)
