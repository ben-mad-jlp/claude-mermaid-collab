# Blueprint — `ui/src/hooks/useDaemonInflight.ts`

## Scope of THIS leaf

Create ONE new file: `ui/src/hooks/useDaemonInflight.ts` (plus a colocated vitest
`ui/src/hooks/useDaemonInflight.test.ts`). This is a split child of leaf
`bccd8c87`. The parent's goal is that **all four views** (FleetGraph, Plan list,
Kanban, Plan graph) light up `inflight` nodes from the **same** live source. Today
only `FleetGraph` does, because the daemon-ledger polling logic is **inlined
inside `FleetGraph.tsx`** (it never flips a todo's local status, so without this
overlay a headless-building leaf reads as `backlog`).

This leaf extracts that inlined logic into a **shared, reusable hook** so the
sibling leaves (which edit `PlanKanban.tsx`, the Plan list/graph, and refactor
`FleetGraph.tsx` to consume it) all subscribe to ONE update source. This file does
NOT edit any consumer — it only provides the hook + its test. Wiring the four
views to call it is done by sibling split-children of `bccd8c87`.

## Source of truth being extracted

`ui/src/components/supervisor/bridge/fleet/FleetGraph.tsx:135-165` currently holds:
- `const [inflightLeafIds, setInflightLeafIds] = useState<Set<string>>(() => new Set());`
- an effect keyed on `graphProject` that:
  - bails to an empty Set when project is null,
  - `fetch('/api/leaf-executor/daemon?project=' + encodeURIComponent(project))`,
  - extracts `d.inflight[].leafId` (string-guarded) into an array,
  - sets the Set **only when the membership actually changed** (stable reference
    so downstream `useMemo`s don't churn — critical, this is the never-jump
    contract from `useFleetGraph`),
  - polls every 4_000ms, cancels on unmount/project change.

`InflightPanel.tsx:113-127` additionally listens on the websocket
(`getWebSocketClient().onMessage`) for `session_todos_updated` / `worker_phase`
and bumps a nonce to re-poll promptly. The shared hook should **combine both**:
the 4s poll floor PLUS an immediate re-poll on the ws nudge, so the non-graph
views become as reactive as the graph (the parent's core complaint: list/kanban/
plan-graph stay stale because they read a snapshot and never re-derive on the
live event).

## Exact shape to implement

`useDaemonInflight.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';

/**
 * useDaemonInflight — the SHARED live "what is the headless leaf-executor running
 * right now" signal, keyed by leafId === todoId. Returns a STABLE Set<string> of
 * todo ids the daemon reports as in-flight; the reference only changes when the
 * membership changes, so consumer useMemos (node data, kanban buckets) never churn.
 *
 * Headless runs leave no tmux and never flip the todo's local claimedBy/in_progress,
 * so a building leaf reads as `backlog` everywhere unless a view overlays this set
 * → the `inflight` bucket. Extracted from FleetGraph so the Plan list, Kanban and
 * Plan graph subscribe to the IDENTICAL source the FleetGraph already uses, keeping
 * all four views in lockstep.
 *
 * Refresh: ws `session_todos_updated`/`worker_phase` nudge (immediate re-poll) plus
 * a bounded 4s poll floor (the headless path emits no dedicated ws event).
 */
const POLL_MS = 4_000;
const EMPTY: ReadonlySet<string> = new Set();

export function useDaemonInflight(project: string | null | undefined): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  // Nonce bumped by the ws nudge to force an out-of-band re-poll.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated' || msg?.type === 'worker_phase') {
        setNonce((n) => n + 1);
      }
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!project) { setIds((prev) => (prev.size === 0 ? prev : new Set())); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/leaf-executor/daemon?project=${encodeURIComponent(project)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        const next: string[] = Array.isArray(d?.inflight)
          ? d.inflight.map((r: { leafId?: string }) => r.leafId).filter((x: unknown): x is string => typeof x === 'string')
          : [];
        // Stable reference when unchanged so consumer memos never churn.
        setIds((prev) => (prev.size === next.length && next.every((i) => prev.has(i)) ? prev : new Set(next)));
      } catch { /* best-effort; keep last good (views fall back to local buckets) */ }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [project, nonce]);

  return ids;
}

export default useDaemonInflight;
```

Notes / decisions:
- **Signature** `useDaemonInflight(project: string | null | undefined): Set<string>`
  — mirrors the `graphProject` value FleetGraph already computes. Returning the bare
  Set (not `{ ids }`) lets FleetGraph drop-in replace its `inflightLeafIds` state and
  pass it straight into `useFleetGraph({ ... inflightLeafIds })`. Sibling consumers
  call `useDaemonInflight(project)` then check `set.has(todo.id)` before `bucketTodo`.
- **Empty-project path** sets a stable-empty Set (keep `prev` when already empty) so
  a null→null render doesn't allocate a new reference.
- **Plain `fetch`** (not `apiFetch(serverScope, …)`) to match FleetGraph's existing
  behavior exactly — do NOT change transport in this leaf; a serverScope-aware
  variant is out of scope and would diverge from the graph it must match. (If a
  sibling needs serverScope, that's a follow-up, not here.)
- **ws nudge + nonce**: nonce is a dep of the poll effect, so a `session_todos_updated`
  fires an immediate re-poll AND restarts the interval — exactly the reactivity the
  list/kanban/plan-graph lack today. `worker_phase` is included to match InflightPanel.
- Keep `EMPTY` only if you reference it; the inline stable-empty handling above makes
  it optional — drop the `EMPTY` const if unused to avoid a lint warning.

## Test — `ui/src/hooks/useDaemonInflight.test.ts` (vitest)

Follow the existing hook-test style (`useDiagramUpdateQueue.test.ts`): `vitest`,
`renderHook`/`act` from `@testing-library/react`, `vi.useFakeTimers()`.

Mocks:
- `vi.mock('@/lib/websocket', ...)` exposing `getWebSocketClient` returning an object
  whose `onMessage(handler)` stores the handler and returns `{ unsubscribe: vi.fn() }`;
  expose a helper to invoke the stored handler (to simulate a ws nudge).
- Stub `global.fetch` with `vi.fn()` returning `{ ok: true, json: async () => ({ inflight: [...] }) }`.

Cases:
1. **Returns the daemon inflight leafIds.** project set, fetch resolves
   `inflight: [{ leafId: 'L1' }, { leafId: 'L2' }]` → after flushing the initial
   poll, `result.current` has `L1`,`L2`.
2. **Stable reference when membership unchanged.** Advance timers one `POLL_MS`
   with the same response → `result.current` is the SAME Set object (identity check)
   — guards the never-churn contract.
3. **New reference when membership changes.** Second poll returns `[{leafId:'L1'}]`
   → reference changed, set is `{L1}`.
4. **Null project → empty set, no fetch.** `useDaemonInflight(null)` → empty Set and
   `fetch` not called.
5. **ws nudge triggers an immediate re-poll.** With fake timers, fire the stored
   `session_todos_updated` handler inside `act` → `fetch` called again before the 4s
   interval elapses; updated membership reflected.
6. **Cleanup.** Unmount → interval cleared (no further fetch after advancing timers)
   and `unsubscribe` called.

Use `await act(async () => { ... })` / `vi.runOnlyPendingTimersAsync()` to flush the
async poll under fake timers (the fetch promise resolves on the microtask queue).

## Acceptance for this leaf
- `ui/src/hooks/useDaemonInflight.ts` exists, default + named export `useDaemonInflight`.
- `npm run test:ci -- ui/src/hooks/useDaemonInflight.test.ts` is green.
- `tsc` clean (the hook is self-contained; only deps are React + `@/lib/websocket`).
- ui/ is Bun-managed — **never npm install**.

Out of scope (sibling split-children of `bccd8c87`): refactoring `FleetGraph.tsx` to
consume this hook, wiring `PlanKanban.tsx` / Plan list / Plan graph to overlay the set
onto `bucketTodo`, and the separate claim-lifecycle fix (75f7e304).

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/hooks/useDaemonInflight.ts", "ui/src/hooks/useDaemonInflight.test.ts"],
  "filesToEdit": [],
  "tasks": [
    { "id": "hook", "files": ["ui/src/hooks/useDaemonInflight.ts"], "description": "Create shared useDaemonInflight hook: ws-nudge + 4s poll of /api/leaf-executor/daemon, returns stable Set<string> of inflight leafIds" },
    { "id": "test", "files": ["ui/src/hooks/useDaemonInflight.test.ts"], "description": "Vitest: membership, stable/new reference, null-project, ws-nudge re-poll, cleanup" }
  ] }
```
