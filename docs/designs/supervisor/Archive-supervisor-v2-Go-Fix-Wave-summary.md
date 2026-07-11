# Fix Wave Summary (v2 review)

## Issues Fixed (both in src/services/supervisor-store.ts)
- **bug-important-listlocks-expired** — `listLocks()` returned expired locks, so GET /locks and the SupervisorPanel 🔒 badge showed locks forever after expiry. Fixed: `SELECT * FROM attended_lock WHERE expiresAt > ?` with `Date.now()`, matching `isLocked()`'s expiry semantics. (Nudge logic was already correct — `supervisor_reconcile` uses `isLocked`.)
- **bug-minor-escalation-dedup-project** — `createEscalation` dedup keyed on `session + questionText` only; identical text across two projects with the same session name would collapse. Fixed: added `project` to the dedup WHERE clause and to `idx_esc_open`.

## Verification
- tsc clean on supervisor-store.ts (no non-TS5097 errors).

## Completeness
- No gaps — all 8 v2 tasks complete and real.

## Final TSC
clean for supervisor v2 files (pre-existing shared-tree/prod-build errors unrelated).
