Here is the complete blueprint, verbatim:

---

# Blueprint: Bridge kanban — color EpicNode by epic's own derived status

**Todo ID:** b592428f-91f4-4abc-a725-d2a95ed92486

## Context

The FleetGraph `EpicNode` currently shows a gray-bordered header regardless of the epic's own work state. Child distribution is already shown in the `StatusBar`. This change adds a `ownBucket: FunnelKey` field derived from the epic's own `derivedStatus` + child counts, and uses it to tint the header band and border in both the expanded (framed container) and collapsed variants.

The "ready todos = violet" coloring is **already shipped** (`STATUS_STYLE.ready` is violet). This blueprint covers only the **epic-level** coloring.

---

## File 1 — `ui/src/components/supervisor/bridge/funnel.ts`

### 1a. Add `border` field to `StatusStyle` interface (line 152)

`StatusStyle` currently has `dot`, `pill`, `tint`, `bg`. Add `border` — uses existing Tailwind color families only, no new semantic tokens.

```ts
// Before
export interface StatusStyle { dot: string; pill: string; tint: string; bg: string; }

// After
export interface StatusStyle { dot: string; pill: string; tint: string; bg: string; border: string; }
```

### 1b. Populate `border` in all five `STATUS_STYLE` entries (lines 153–159)

Keep all existing fields verbatim; append `border` to each:

```ts
export const STATUS_STYLE: Record<FunnelKey, StatusStyle> = {
  backlog:  { dot: 'bg-gray-400',    pill: '…', tint: '…', bg: '…', border: 'border-gray-300 dark:border-gray-600' },
  ready:    { dot: 'bg-violet-500',  pill: '…', tint: '…', bg: '…', border: 'border-violet-300 dark:border-violet-600' },
  inflight: { dot: 'bg-info-500',    pill: '…', tint: '…', bg: '…', border: 'border-info-300 dark:border-info-600' },
  blocked:  { dot: 'bg-warning-500', pill: '…', tint: '…', bg: '…', border: 'border-warning-300 dark:border-warning-600' },
  done:     { dot: 'bg-success-500', pill: '…', tint: '…', bg: '…', border: 'border-success-300 dark:border-success-600' },
};
```

### 1c. Add `epicBucket()` resolver (insert after `statusStyle`, before `excludeEpics`)

```ts
/**
 * Resolve an epic's OWN visual bucket from child-distribution counts and the
 * epic's own derived status string (from `derivedStatus()` in claimability.ts).
 *
 * Precedence (highest → lowest):
 *   1. counts.inflight > 0  → 'inflight'   (child work is running)
 *   2. counts.blocked  > 0  → 'blocked'    (a child is stuck)
 *   3. ownDerivedStatus 'done'/'dropped' → 'done'
 *   4. ownDerivedStatus 'ready'          → 'ready'  (approved, nothing live yet)
 *   5. else                              → 'backlog' (unapproved / planned)
 */
export function epicBucket(
  counts: Record<FunnelKey, number>,
  ownDerivedStatus: string,
): FunnelKey {
  if (counts.inflight > 0) return 'inflight';
  if (counts.blocked  > 0) return 'blocked';
  if (ownDerivedStatus === 'done' || ownDerivedStatus === 'dropped') return 'done';
  if (ownDerivedStatus === 'ready') return 'ready';
  return 'backlog';
}
```

---

## File 2 — `ui/src/components/supervisor/bridge/fleet/types.ts`

Add `ownBucket: FunnelKey` to `EpicNodeData` after `total` (line 13):

```ts
export interface EpicNodeData extends Record<string, unknown> {
  kind: 'epic';
  label: string;
  counts: Record<FunnelKey, number>;
  total: number;
  /** The epic's own visual status bucket (drives header tint + border color). */
  ownBucket: FunnelKey;
  expanded?: boolean;
  width?: number;
  height?: number;
}
```

---

## File 3 — `ui/src/components/supervisor/bridge/fleet/useFleetGraph.ts`

### 3a. Extend imports (lines 17–18)

```ts
// Extend the funnel import to include epicBucket:
import { bucketTodo, epicBucket, type FunnelKey } from '../funnel';

// Add a new import for derivedStatus (not currently imported here):
import { derivedStatus } from '@/lib/claimability';
```

`claimability.ts` is already used indirectly via `bucketTodo`/`funnel.ts`; `derivedStatus` is not yet imported directly in `useFleetGraph.ts`.

### 3b. Compute `ownBucket` in the epic-node branch (~lines 351–363)

In the `nodes` memo, inside the `if (struct.epicIds.has(t.id))` block, after building `counts`/`total` and before constructing `data`:

```ts
// Add this line:
const ownBucket = epicBucket(counts, derivedStatus(t, struct.byId));

// Then pass ownBucket into EpicNodeData (both the sized and non-sized shapes):
const data: EpicNodeData = size
  ? { kind: 'epic', label: t.title, counts, total, ownBucket, expanded: true, width: size.width, height: size.height }
  : { kind: 'epic', label: t.title, counts, total, ownBucket };
```

`struct.byId` is already in scope (built in the `struct` memo and listed in `nodes`' dependency array).

---

## File 4 — `ui/src/components/supervisor/bridge/fleet/nodes/EpicNode.tsx`

### 4a. Replace the `ring` + border logic (lines 56–59)

**Current:**
```ts
const ring = selected ? 'ring-2 ring-accent-500 border-accent-300' : 'border-gray-300 dark:border-gray-600';
```

**Replace with — separate the border-color class from the ring so there is never a Tailwind CSS-order conflict between the bucket border and the selection border:**

```ts
const bucketBorder = STATUS_STYLE[d.ownBucket].border;
const ring = selected ? 'ring-2 ring-accent-500 border-accent-300' : bucketBorder;
```

When selected, `ring-2 ring-accent-500 border-accent-300` is the entire `ring` value — the bucket border is not present in the string and there is no conflict. When not selected, the bucket border class is the `ring` value and is the only border-color applied.

### 4b. Expanded variant: tint the header band (line 69)

**Current:**
```tsx
<div className="px-3 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-t-lg">
```

**Replace** `bg-white dark:bg-gray-900` with `STATUS_STYLE[d.ownBucket].bg`:
```tsx
<div className={`px-3 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-700 ${STATUS_STYLE[d.ownBucket].bg} rounded-t-lg`}>
```

The `STATUS_STYLE[*].bg` values include a background and a text-color token. The explicit `text-gray-800`/`text-gray-100` and `text-gray-400` classes on children take precedence — no label-color regression.

### 4c. Collapsed variant: tint the outer chip (line 85)

**Current:**
```tsx
<div
  className={`rounded-lg bg-white dark:bg-gray-900 border px-3 py-2 ${ring}`}
  style={{ width: 200 }}
>
```

**Replace** `bg-white dark:bg-gray-900` with `STATUS_STYLE[d.ownBucket].bg`:
```tsx
<div
  className={`rounded-lg border ${STATUS_STYLE[d.ownBucket].bg} px-3 py-2 ${ring}`}
  style={{ width: 200 }}
>
```

The outer `border` utility (not a color class) keeps the border visible; the `ring` value (which IS the border-color class when not selected) or `border-accent-300` (when selected) colors it.

**The `StatusBar` component and `EpicCost` are untouched.**

---

## File 5 — `ui/src/components/supervisor/bridge/fleet/useFleetGraph.test.ts`

Add the `epicBucket` import at the top of the file (alongside the existing imports):

```ts
import { epicBucket } from '../funnel';
```

Add three new tests inside the existing `describe('useFleetGraph', …)` block:

### Test A — epic with an in-flight child → `ownBucket = 'inflight'`

```ts
it('ownBucket: epic with an in-flight child is bucketed as inflight', () => {
  const todos = [
    todo({ id: 'E1' }),
    todo({ id: 'A', parentId: 'E1', status: 'in_progress', claimedBy: 'worker-x' }),
  ];
  const { result } = renderHook(() =>
    useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
  );
  const epic = result.current.nodes.find((n) => n.id === 'E1')!;
  expect((epic.data as { ownBucket: string }).ownBucket).toBe('inflight');
});
```

### Test B — all children done → `ownBucket = 'done'` (pure-function test)

The hook's topology filter hides epics whose every child is done before they reach the node list. Test `epicBucket` directly:

```ts
it('epicBucket: all-done child counts + epic done status → "done"', () => {
  const counts = { backlog: 0, ready: 0, inflight: 0, blocked: 0, done: 3 };
  expect(epicBucket(counts, 'done')).toBe('done');
});
```

### Test C — approved-not-started epic → `ownBucket = 'ready'`

```ts
it('ownBucket: approved epic with no inflight/blocked children is bucketed as ready', () => {
  const now = new Date().toISOString();
  const todos = [
    todo({ id: 'E1', approvedAt: now }),
    todo({ id: 'A', parentId: 'E1', status: 'planned' }),
  ];
  const { result } = renderHook(() =>
    useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
  );
  const epic = result.current.nodes.find((n) => n.id === 'E1')!;
  // Epic is approved + no pending deps + no heldAt → derivedStatus='ready' → ownBucket='ready'
  expect((epic.data as { ownBucket: string }).ownBucket).toBe('ready');
});
```

`claimReason` for an approved epic with no pending deps and no heldAt returns `'claimable'` → `derivedStatus` returns `'ready'` → `epicBucket(counts, 'ready')` where all child counts are zero (children are in 'planned' = backlog bucket) → returns `'ready'`.

---

## Summary of changes

| File | Change |
|------|--------|
| `funnel.ts` | Add `border` to `StatusStyle` interface + all 5 `STATUS_STYLE` entries; add `epicBucket()` export |
| `fleet/types.ts` | Add `ownBucket: FunnelKey` to `EpicNodeData` |
| `fleet/useFleetGraph.ts` | Import `epicBucket` + `derivedStatus`; compute `ownBucket` in the epic branch; thread into both `EpicNodeData` shapes |
| `fleet/nodes/EpicNode.tsx` | Separate `bucketBorder`/`ring`; apply `.bg` to header band (expanded) and outer div (collapsed); `StatusBar` untouched |
| `fleet/useFleetGraph.test.ts` | Import `epicBucket`; add 3 tests (A: inflight-child hook, B: done pure-fn, C: approved-ready hook) |

No new Tailwind color tokens — `border-violet-*`, `border-info-*`, `border-warning-*`, `border-success-*` are border variants of colors already present in `STATUS_STYLE`.

```json
{
  "schemaVersion": 1,
  "estimatedFiles": 5,
  "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "ui/src/components/supervisor/bridge/funnel.ts",
    "ui/src/components/supervisor/bridge/fleet/types.ts",
    "ui/src/components/supervisor/bridge/fleet/useFleetGraph.ts",
    "ui/src/components/supervisor/bridge/fleet/nodes/EpicNode.tsx",
    "ui/src/components/supervisor/bridge/fleet/useFleetGraph.test.ts"
  ],
  "tasks": [
    { "id": "funnel-epicbucket", "files": ["ui/src/components/supervisor/bridge/funnel.ts"], "description": "Add border field to StatusStyle + all 5 STATUS_STYLE entries; export epicBucket() resolver" },
    { "id": "types-ownbucket", "files": ["ui/src/components/supervisor/bridge/fleet/types.ts"], "description": "Add ownBucket: FunnelKey to EpicNodeData" },
    { "id": "hook-compute-ownbucket", "files": ["ui/src/components/supervisor/bridge/fleet/useFleetGraph.ts"], "description": "Import epicBucket+derivedStatus; compute ownBucket in epic branch; pass into both EpicNodeData shapes" },
    { "id": "epicnode-tint", "files": ["ui/src/components/supervisor/bridge/fleet/nodes/EpicNode.tsx"], "description": "Separate bucketBorder/ring; apply STATUS_STYLE[d.ownBucket].bg to header band + outer div in both variants" },
    { "id": "tests-ownbucket", "files": ["ui/src/components/supervisor/bridge/fleet/useFleetGraph.test.ts"], "description": "Import epicBucket; add 3 tests: inflight-child (hook), all-done (pure epicBucket), approved-ready (hook)" }
  ]
}
```