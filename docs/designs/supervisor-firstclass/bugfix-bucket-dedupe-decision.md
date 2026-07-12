# DR-bugfix-bucket-dedupe: Duplicate Bucket Deduplication

## Decision

**Exactly one bucket epic of each kind is allowed per project.**

The four duplicate `Bugfix inbox` bucket rows (`98a779a1`, `9759e36f`, `3a6023e9`) have been **merged forward to the canonical row `a41c8051`**, then **retired** (set `isBucket=0, status='dropped'`).

The canonical `Inbox` bucket (`bb4a9a5d`) is untouched — it is a distinct bucket type.

### Canonical Row

- **ID**: `a41c8051` (Bugfix inbox)
- **Rationale**: It is the earliest and most-referenced Bugfix bucket. The V3 migration comment in `todo-store.ts:522-523` already singles it out as having a title suffix that the title-predicate in leaf C misses, making it the row the code already treats as primary.

### Disposition Table

| ID | Kind | Action |
|---|---|---|
| `bb4a9a5d` | Inbox | Untouched (separate bucket) |
| `a41c8051` | Bugfix inbox | **Canonical** — stays `isBucket=1`, non-dropped |
| `98a779a1` | Bugfix inbox | **Retired** — merge children forward to `a41c8051`, then set `isBucket=0, status='dropped'` |
| `9759e36f` | Bugfix inbox | **Retired** — merge children forward to `a41c8051`, then set `isBucket=0, status='dropped'` |
| `3a6023e9` | Bugfix inbox | **Retired** — merge children forward to `a41c8051`, then set `isBucket=0, status='dropped'` |

## Enforcement Mechanism

**Create-time guard** in `resolveTodoParent` (not an invariant kind).

### Why Create-Time, Not Invariant Kind

- A **create-time guard is enforced, not asked** — it makes the fifth bucket *unrepresentable at the source* (per CLAUDE.md and `feedback_prohibitions_in_prompts_are_not_constraints`).
- An `invariant_check` violation kind is a read-only health report — it would surface a second bucket *after it already exists*, i.e., after a split has happened.
- This guard directly answers the FACT in the epic description: "when the title WAS the identity, nothing stopped a fifth" — by making a duplicate unrepresentable, we enforce the invariant before it breaks.

### Guard Behavior

The guard compares buckets on their **normalized title** (via `stripLabel().toLowerCase()`), so:
- A second `Bugfix inbox` create is **refused** with `DuplicateBucketError`.
- `Inbox` and `Bugfix inbox` remain **distinct buckets** (different normalized titles).
- The find-or-create Inbox path (`:999` in `todo-store.ts`) already checks for existence first, so it never triggers its own guard.

## No Frozen Dependents (SR-4)

Buckets are work-graph roots — nothing holds a `dependsOn` edge pointing *at* a bucket, only `parentId` edges point *in*. The disposition **re-homes children BEFORE retiring** the 3 non-canonical rows, so no child is ever left stranded with a broken `parentId` reference.

Re-home → retire ordering is enforced in the V4 migration SQL: the `UPDATE todos SET parentId=?` runs before `UPDATE todos SET isBucket=0, status='dropped'`.

See also [[project_inbox_planning_only]]: Inbox epics are never conductor-landable; they are planning-only (children are approved manually, not auto-claimed by the daemon).

## Acceptance Criteria

1. Decision record (this doc) exists, names canonical `a41c8051` and the merge-forward-then-retire disposition, and states the create-time-guard enforcement + why.
2. V4 migration in `todo-store.ts` re-homes the 3 retired buckets' children and sets those rows `isBucket=0, status='dropped'`.
3. `DuplicateBucketError` is exported from `todo-store.ts` and thrown in `resolveTodoParent` when a create resolves `isBucketCreate` and a live same-normalized-title `isBucket` epic already exists.
4. Test suite asserts post-migration count, re-homed children with no frozen dependents, and second-bucket-create rejection.
