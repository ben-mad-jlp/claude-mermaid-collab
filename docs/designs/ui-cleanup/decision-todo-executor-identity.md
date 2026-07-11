# Decision: todo "executor" identity — refactor or not

## Context
Surfacing "the worker session that executed a todo" in the UI exposed muddle in the
todo "who" model:
- `assigneeSession` — intent; often null for coordinator work.
- `claimedBy` — ALWAYS `COORDINATOR_ID` (a reservation lock), never the worker. Cleared off `in_progress`.
- `sessionName` — OVERLOADED: worker pool-lane for coordinator todos; creating session for manual todos. Persists across done.
- `completedBy` — human-completion actor only.

Current shipped fix (v5.85.15): UI reads `sessionName` as the executor. Works, but
relies on the overloaded field.

## Grok consult (skeptical framing) — verdict
1. `sessionName`-as-executor = latent bug magnet (overload; couples coordinator launch, manual-create, and UI). Agreed.
2. `claimedBy` permanently `'coordinator'` = real smell (lock vs execution identity conflated). Agreed.
3. Recommended: add nullable `executedBySession`, populate at worker-launch, UI reads only that; optionally rename `claimedBy→reservedBy` (lower priority); leave `sessionName`. **Do it now** — `ALTER TABLE` + 1 write + 1 read is cheap.

## Synthesis (our context: local-first, single-user, SQLite-per-project)
- **ACCEPT**: add `executedBySession` (TEXT, nullable). Populate where the coordinator
  already persists the lane (`coordinator-live.ts` `updateTodo({sessionName: poolName})`
  ~lines 495-496/594). UI reads `executedBySession ?? sessionName` (fallback for old rows).
  rowToTodo + UI SessionTodo type get the field.
- **DEFER**: `claimedBy→reservedBy` rename — cosmetic, but touches claim/lease logic +
  claim-invariant SQL + tests. Not worth the blast radius now; document the meaning instead.
- **DISCOUNT**: "lease overbuilt" — load-bearing for crash recovery + worktree isolation.
- **Leave** `sessionName` semantics as-is.

## Status
Recommended but NOT yet executed — awaiting go-ahead. Current v5.85.15 behavior is
correct in practice; this is a clarity/decoupling improvement, not a bug fix.
