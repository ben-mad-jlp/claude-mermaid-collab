# Blueprint — Land-card reconciliation core (idempotent `stampEpicLandedAt`)

## Problem (grounded)

Two durable land facts exist per epic, and they can diverge:

1. **`epic_land_record` DB** — written by `recordEpicLand()` (`src/services/epic-land-record-store.ts:56`), stores `{epicId, epicTipSha, landedMergeSha, landedAt: number}`. This is the *proof of land*, written the moment a merge to master/integration succeeds.
2. **`todos.landedAt` column** — the card's source-of-truth, written by `stampEpicLandedAt()` (`src/services/todo-store.ts:1330`, already idempotent via `COALESCE`).

The daemon's escalation-driven land path writes fact #1 but **never** writes fact #2:

- `src/services/coordinator-live.ts:2288-2298` calls `recordEpicLand(...)` on a successful land, then `src/services/coordinator-live.ts:2302` calls `wm.removeEpic(...)` which deletes the epic branch.
- No `stampEpicLandedAt` call exists anywhere in that success block (contrast the OI-1 path, which stamps at `coordinator-live.ts:844/857/867`).

Consequence: after a real daemon land, the epic is done+accepted but `landedAt` stays `null` → it reads as the *stranded* state (`findLandedAtDivergence`, `invariant-check.ts:181`; the stranded-card test at `reconcile-pass.test.ts:355`). It can never self-heal downstream because the branch is gone, so `commitOnIntegration` re-probes (`coordinator-live.ts:864`) can't reach it.

## Change shape

**A. New core module `src/services/land-card-reconcile.ts`** — one idempotent reconciler that repairs the divergence from the durable proof:

```ts
import { getEpicLandRecord } from './epic-land-record-store.js';
import { getTodo, stampEpicLandedAt } from './todo-store';

export interface LandCardReconcileResult {
  reconciled: boolean;       // true iff THIS call wrote landedAt
  landedAt: string | null;   // the epic's landedAt after the call (ISO), or null
}

/**
 * Reconcile an epic's card `landedAt` from the durable epic_land_record proof.
 * Idempotent: a record with landedAt already set is a no-op (reconciled:false);
 * no record is a no-op; stampEpicLandedAt COALESCEs so re-runs never overwrite.
 */
export function reconcileEpicLandCard(project: string, epicId: string): LandCardReconcileResult {
  const epic = getTodo(project, epicId);
  if (!epic) return { reconciled: false, landedAt: null };
  if (epic.landedAt != null) return { reconciled: false, landedAt: epic.landedAt }; // already stamped

  const record = getEpicLandRecord(project, epicId);
  if (!record) return { reconciled: false, landedAt: null }; // no proof → nothing to reconcile

  const whenIso = new Date(record.landedAt).toISOString(); // epoch-ms → ISO
  stampEpicLandedAt(project, epicId, whenIso);
  return { reconciled: true, landedAt: whenIso };
}
```

Notes: `record.landedAt` is `number` (epoch ms) per `epic-land-record-store.ts:25`; convert to ISO to match the `landedAt TEXT` column. Uses no `Date.now()` — fully deterministic off the stored proof. `stampEpicLandedAt`'s `WHERE ... AND kind = 'epic'` clause already enforces epic-kind, so no extra guard is needed; its own `try/catch` keeps this advisory.

**B. Wire it into the escalation land success path** so a fresh land stamps its own card (and the core isn't dead code). In `src/services/coordinator-live.ts`, immediately after the `recordEpicLand(...)` block (`coordinator-live.ts:2298`), add:

```ts
// Reconcile the epic card's landedAt from the durable proof we just wrote
// (this path records the land but the branch is removed below, so nothing
// downstream can heal the card). Idempotent + advisory.
try { reconcileEpicLandCard(targetProject, epicId); } catch { /* advisory */ }
```

Add `reconcileEpicLandCard` to the imports from `./land-card-reconcile` at the top of `coordinator-live.ts` (near the `recordEpicLand` import at `coordinator-live.ts:82`).

**C. Unit test `src/services/__tests__/land-card-reconcile.test.ts`** — model isolation on `land-proof-single-path.test.ts` (per-project temp dir) + `orphan-worktree-gc.test.ts` (which drives `recordEpicLand` against a temp repo). Create an epic via `createTodo`, then:
- `reconciles-from-record`: `recordEpicLand` with a fixed `landedAt` epoch, then `reconcileEpicLandCard` → `reconciled === true` and `getTodo(...).landedAt` equals the ISO of that epoch.
- `idempotent-second-call-noop`: a second `reconcileEpicLandCard` returns `reconciled === false` and leaves `landedAt` unchanged (first stamp wins).
- `no-record-noop`: no `recordEpicLand` → `reconcileEpicLandCard` returns `{reconciled:false, landedAt:null}` and `landedAt` stays null.

## Acceptance criteria (positive, citable)

1. `src/services/land-card-reconcile.ts` exports `reconcileEpicLandCard(project, epicId)` that returns `{reconciled, landedAt}` and calls `stampEpicLandedAt` with `new Date(record.landedAt).toISOString()` only when `getEpicLandRecord` returns a record and the epic's `landedAt` is null.
2. `src/services/coordinator-live.ts` imports and calls `reconcileEpicLandCard(targetProject, epicId)` in the land-success block after `recordEpicLand` (`coordinator-live.ts:~2298`).
3. `src/services/__tests__/land-card-reconcile.test.ts` contains the three named tests above (reconcile-from-record, idempotent no-op, no-record no-op), all green.

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/land-card-reconcile.ts", "src/services/__tests__/land-card-reconcile.test.ts"],
  "filesToEdit": ["src/services/coordinator-live.ts"],
  "tasks": [
    { "id": "core-reconciler", "files": ["src/services/land-card-reconcile.ts"], "description": "Add idempotent reconcileEpicLandCard reading epic_land_record and stamping landedAt when null" },
    { "id": "wire-escalation-land", "files": ["src/services/coordinator-live.ts"], "description": "Import + call reconcileEpicLandCard after recordEpicLand in the land-success block" },
    { "id": "reconcile-tests", "files": ["src/services/__tests__/land-card-reconcile.test.ts"], "description": "Unit tests: reconcile-from-record, idempotent no-op, no-record no-op" }
  ],
  "leafKind": "fix",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/land-card-reconcile.ts", "symbol": "reconcileEpicLandCard", "description": "Idempotent core: stamps epic landedAt from the durable epic_land_record proof" },
    { "kind": "symbol-present", "file": "src/services/coordinator-live.ts", "symbol": "reconcileEpicLandCard", "description": "Escalation land-success path invokes the reconciler after recordEpicLand" },
    { "kind": "named-test", "testFile": "src/services/__tests__/land-card-reconcile.test.ts", "testName": "reconciles the card landedAt from the durable epic_land_record", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/land-card-reconcile.test.ts", "testName": "is idempotent — a second reconcile is a no-op (first stamp wins)", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/land-card-reconcile.test.ts", "testName": "no land record → no-op, landedAt stays null", "mechanical": true }
  ],
  "outOfScope": [
    "Adding a reconcile-pass sweep that heals historically-diverged epics across all cards (separate leaf; this leaf ships the core + the fresh-land wiring only)",
    "Changing stampEpicLandedAt's existing COALESCE semantics or the OI-1 stamp sites (coordinator-live.ts:844/857/867)"
  ] }
```