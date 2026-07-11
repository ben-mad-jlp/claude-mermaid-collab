# Fix Wave Summary — PCS Phase 1

## Issues Fixed
- **bug-important-claim-todo-ready-only** (`src/services/todo-store.ts`): `claimTodo` WHERE narrowed from `status IN ('ready','todo')` to `status='ready'`. Only plan-approved `ready` todos are claimable — which makes `releaseExpiredClaims` resetting an expired claim to `ready` correct (previously a `todo`-status item could be claimed then wrongly promoted to `ready` on lease expiry). Aligns with the plan-level-approval model (planner sets `ready`). Test updated: the "claim status=todo succeeds" case now asserts null ("claiming a non-ready (todo) status returns null").

## Not fixed (accepted — Minor / by-design)
- Migration sentinel written after the backfill loop: `importTodo` is INSERT OR IGNORE and the parentId `updateTodo` is value-idempotent, so a mid-run crash safely re-runs. Accept.
- `addColumnIfMissing` no absent-table guard: unreachable in current call sites. Accept.
- `importTodo` has no `assigneeSession` param: by design (roadmap items → ownerSession=`__roadmap__`, assignee defaults to owner). Accept.

## Files Changed
- src/services/todo-store.ts (claimTodo WHERE)
- src/services/__tests__/todo-store.test.ts (test updated)

## Final TSC / tests
tsc clean (exit 0); `bun test` → 33 pass / 0 fail.

## Completeness
0 gaps. Known deferrals (not gaps): acceptance-gate logic (Phase 2), Coordinator using claimTodo (Phase 2), per-project migration on register (filed todo). Scope guard held — shipped supervisor feature untouched.
