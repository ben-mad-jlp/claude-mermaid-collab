# Blueprint — Per-todo headless run view: live node progress + verdict on the todo detail

Leaf: `9a9a3f66-f2cf-4bfd-b7f7-a5ccded2d85d`
Epic branch: `collab/epic/5bcd5b8d` (P1+P2+P3+P4a built)

## Problem

The leaf-executor runs a todo headlessly (blueprint→implement→review nodes) and creates
**no tmux session**. The existing session-based fleet UI (LaneCallout, WorkerRunSummary,
WorkerRoster) is keyed on lanes / session-status rows, so a headless leaf run shows
**nothing** — even though P4a now records every node to the ledger and exposes it.

Goal: when a todo is opened in the Bridge detail tab, show a compact strip that watches
its headless run **node-by-node** (kind + model + status dot + duration) plus a header
(attempt X/2, nodesSpent/20, final outcome, review verdict), live while in_progress.

## Ground truth (verified from P4a + existing UI)

- **leafId === todoId.** `src/services/leaf-executor.ts:217,220` (and 254/257, 285/319)
  set both `todoId` and `leafId` to `leaf.id`. So the selected todo's `id` IS the leafId —
  **no lookup/mapping needed.** The fetch key is `selectedTodoId` directly.
- **Endpoint:** `GET /api/leaf-executor/run/:leafId` (`src/routes/api.ts:2876-2885`).
  - Found: `{ leafId, ran:false }` when no rows.
  - Ran: `{ ran:true, ...LeafRunStats }` where `LeafRunStats` (`src/services/ledger-stats.ts:40-54`)
    is: `leafId, epicId, project, nodes[], attempts, nodesSpent, nodeBudget(=20), budgetPct,
    wallClockMs, rateLimitedCount, authModes, finalOutcome('accepted'|'rejected'|'blocked'|'paused'|null),
    reviewVerdict('pass'|'fail'|null)`.
  - `nodes[]` is `LeafNodeStat` (ledger-stats.ts:29-38), **chronological**:
    `{ nodeKind('blueprint'|'implement'|'review'|null), model, authMode, exitCode(number|null),
    durationMs(number|null), rateLimited(bool|null), ts, verdict? }`.
- **No new ws event** allowed (constraint b2fe36b1). The endpoint is a plain GET; P4a's own
  header docstring says "Bridge fetches on demand / on existing ws nudges."
- **Existing pattern to mirror:** `ui/src/components/supervisor/bridge/WorkerRunSummary.tsx`
  — a `React.FC<{ todoId; project }>` that `useEffect`-fetches `/api/worker-run`, guards with
  a `cancelled` flag, renders a header strip + per-row list + a `ran:false` quiet empty state.
  **Mirror this exactly** (same card chrome classes, same fetch/cancel shape).
- **Mount point already exists:** `TodoWorkerPanel` (`LaneCallout.tsx:24-38`) is rendered at
  `BridgeDashboard.tsx:521` inside the `bridgeTab === 'detail'` branch, directly **above**
  `TodoDetailView` (line 523). It currently switches LaneCallout (live lane) vs WorkerRunSummary
  (durable session record). The new strip slots in alongside these.
- **Todo status for poll-gating:** the selected todo lives in
  `todosByProject[project]` (`supervisorStore`, surfaced in BridgeDashboard as `todos`,
  line 204). `SessionTodo.status` (`ui/src/types/sessionTodo.ts:18`) is a `TodoStatus`;
  `'in_progress'` is the active state. `'done'|'blocked'|'dropped'` are terminal.
- **Existing ws refetch trigger:** `session_todos_updated` (`BridgeDashboard.tsx:153`,
  `ui/src/lib/todoEvents.ts`). The daemon fires it on claim→in_progress→done transitions, so
  it already reaches the Bridge. We reuse it (NO new event type).

## Design

### 1. New component — `WorkerRunStrip.tsx`

Path: `ui/src/components/supervisor/bridge/WorkerRunStrip.tsx`

```
export const WorkerRunStrip: React.FC<{ leafId: string; isActive: boolean }>
```

- `leafId` = the selected todo id. `isActive` = `todo.status === 'in_progress'` (drives polling).
- **Types** (local interfaces, mirror ledger-stats):
  - `LeafNode { nodeKind, model, authMode, exitCode, durationMs, rateLimited, ts, verdict? }`
  - `LeafRunResponse { ran: boolean; leafId: string; ... } & Partial<LeafRunStats>` — discriminate on `ran`.
- **Fetch** (mirror WorkerRunSummary.tsx:46-64): `useEffect`, `cancelled` flag, `setLoading`,
  `fetch('/api/leaf-executor/run/' + encodeURIComponent(leafId))` → `r.ok ? r.json() : null`.
  Deps: `[leafId, refetchNonce]` (nonce explained in §3).
- **Render — three states:**
  - `loading && !data` → "loading…" muted.
  - `data.ran === false` (or null) → quiet placeholder: card chrome + italic "No headless
    run yet." (mirror WorkerRunSummary.tsx:122-129 minus the PhasePipelineStrip — see Reuse note).
  - `data.ran === true` →
    - **Header line** (one row, `text-2xs tabular-nums`): `attempt {attempts}/2` ·
      `{nodesSpent}/{nodeBudget} nodes` · `{wallClockMs}` (format ms→s) · final-outcome badge
      (`finalOutcome`: accepted=green, rejected/blocked=red, paused=amber, null=muted "running")
      · review-verdict badge (`reviewVerdict`: pass=green, fail=red, null=muted).
    - **Node row** — horizontal flex of N chips, one per `nodes[]` entry:
      - label: `nodeKind` (Blueprint / Implement / Review) + `· {model}` (small/muted).
      - **status dot** (`h-2 w-2 rounded-full`, mirror LaneCallout.tsx:59 dot idiom):
        - last node AND `isActive` AND no terminal outcome → **running**: `bg-accent-500 animate-pulse`.
        - `rateLimited === true` → **amber** (`bg-amber-500`).
        - `exitCode === 0` → **green** (`bg-green-500`).
        - `exitCode != null && exitCode !== 0` → **red** (`bg-red-500`).
        - else (no exit yet) → running pulse / grey.
      - duration: `{durationMs}` formatted (ms→`x.xs`), `tabular-nums` muted.
- **Card chrome:** reuse WorkerRunSummary's exact wrapper classes
  (`m-3 mb-0 rounded-lg border ... bg-gray-50/60 ...`) + the `text-[10px] uppercase tracking-wide
  text-gray-400` section label "headless run" — satisfies 329741da (ONE card language / type scale).
  Badges use the same 2xs/3xs pill idiom already in WorkerRunSummary (lines 108-116).

### 2. Where it mounts

`TodoWorkerPanel` (`ui/src/components/supervisor/bridge/LaneCallout.tsx:24-38`).

Today it returns `LaneCallout` (live lane) **or** `WorkerRunSummary` (durable session record).
The headless run is a THIRD, orthogonal source — it has no lane and no `/api/worker-run` phase
rows. Add `WorkerRunStrip` so a headless-executed todo isn't blank:

- Render `WorkerRunStrip` **always** (it self-suppresses to the quiet placeholder when
  `ran:false`, so non-headless todos cost one cheap GET that returns `{ran:false}` and a small
  muted line — acceptable, and consistent with WorkerRunSummary which also always renders).
  Place it directly under the existing LaneCallout/WorkerRunSummary block, both inside
  `TodoWorkerPanel`'s returned fragment.
- `TodoWorkerPanel` needs `isActive`. It already receives `todoId, project, serverId`. Add the
  status: cheapest is to pass the selected todo's `status` down from BridgeDashemboard, OR read it
  inside TodoWorkerPanel from `supervisorStore` (`todosByProject[project].find(t=>t.id===todoId)?.status`).
  **Preferred:** read from the store inside TodoWorkerPanel (keeps BridgeDashboard:521 call site
  unchanged) via a `useSupervisorStore` selector. Compute `isActive = status === 'in_progress'`.
- BridgeDashboard line 521 stays as-is. No prop changes at the call site.

### 3. Refresh strategy (b2fe36b1-compliant — NO new ws event)

Two-tier, both inside `WorkerRunStrip`:

1. **ws nudge (primary):** subscribe to the existing `session_todos_updated` event (same source
   BridgeDashboard already listens to at line 153). On any matching event for this project, bump
   a local `refetchNonce` → triggers the `useEffect` refetch. This catches node-boundary status
   changes that the daemon already emits. Reuse `ui/src/lib/todoEvents.ts:shouldRefetchTodos`
   predicate if convenient; otherwise the websocket subscription helper already imported in
   BridgeDashboard (`@/lib/websocket`). **No new event type is introduced.**
2. **Bounded poll (fallback, only while genuinely live):** `setInterval` every **2500ms** that
   bumps `refetchNonce`, **gated** by `isActive === true` (todo `in_progress`) AND
   `data?.finalOutcome == null` (no terminal outcome yet). `clearInterval` in cleanup and the
   moment either gate flips false. This covers the gap where nodes advance *between* ws events
   (a single headless node can take minutes with no todo-status change). Poll stops dead once the
   run reaches a terminal outcome or the todo leaves in_progress — no idle polling.

Rationale: ws alone is too coarse (status only flips at claim/done, not per-node); a *gated*
poll respects b2fe36b1 (no new transport, no new event) and only runs while the detail is open
(component mounted) AND the leaf is actually executing.

### 4. Reuse (compose, don't build — constraint 00c8adb9)

- **Mirror** `WorkerRunSummary.tsx` for fetch/cancel shape, card chrome, empty-state, badge pills.
- **Reuse** the status-dot className idiom from `LaneCallout.tsx:59`
  (`h-2 w-2 rounded-full shrink-0 ... animate-pulse`).
- **Do NOT reuse `PhasePipelineStrip`/`RECIPE_PHASES`** — those are the worker-fabric phase set
  (`sizegate|research|authortests|implement|verify|review`), a different vocabulary from the
  leaf-executor's node kinds (`blueprint|implement|review`). Forcing leaf nodes through it would
  mislabel them. The horizontal node chips are a thin bespoke row (no new "engine"), keeping the
  same 2xs/3xs type scale (329741da). This is the one genuinely-new piece of markup.
- **Reuse** `useSupervisorStore` for the todo status (no new store, no new fetch).
- **Endpoint + data:** entirely P4a (`getLeafRun` + `/api/leaf-executor/run/:leafId`) — invent nothing.

### 5. Testability

UI-only; a live executor is NOT required (the strip is only *populated* by real `LEAF_EXECUTOR=on`
runs — note for later).

- **Render test** `ui/src/components/supervisor/bridge/WorkerRunStrip.test.tsx`
  (mirror existing bridge `*.test.tsx`: vitest + `@testing-library/react`, `vi.mock` deps,
  stub `global.fetch`):
  1. fetch resolves `{ran:false}` → asserts the "No headless run yet" placeholder renders.
  2. fetch resolves a `ran:true` fixture with 3 nodes (blueprint exit0, implement exit0,
     review verdict pass, finalOutcome accepted) → asserts 3 node chips, the header shows
     `attempt 1/2`, `3/20`, and a pass/accepted badge.
  3. an in-progress fixture (last node `exitCode:null`, `finalOutcome:null`) with `isActive=true`
     → asserts the last dot carries the `animate-pulse` class (running).
  4. (poll gate) with `isActive=false` advance fake timers → assert no extra fetch fired
     (`vi.useFakeTimers`, `vi.advanceTimersByTime`, fetch call-count unchanged).
- **Manual path:** open the Bridge → select any todo → confirm the "headless run" card shows the
  quiet placeholder for a never-headless todo; for a todo run under `LEAF_EXECUTOR=on`, confirm the
  node chips + header populate and the running dot pulses while in_progress.
- `bun run test:ci -- WorkerRunStrip` (ui/ is Bun-managed — e4475a38; never npm install).

### 6. File-by-file change list

| File | Change |
|------|--------|
| `ui/src/components/supervisor/bridge/WorkerRunStrip.tsx` | **NEW.** The strip component (fetch + ws nudge + gated poll + node chips + header). |
| `ui/src/components/supervisor/bridge/WorkerRunStrip.test.tsx` | **NEW.** Render tests (4 cases above). |
| `ui/src/components/supervisor/bridge/LaneCallout.tsx` | **EDIT `TodoWorkerPanel`** (lines 24-38): import `WorkerRunStrip`; read selected todo status from `useSupervisorStore`; render `<WorkerRunStrip leafId={todoId} isActive={status==='in_progress'} />` beneath the existing LaneCallout/WorkerRunSummary in a fragment. |
| `BridgeDashboard.tsx` | **No change** — call site at line 521 unchanged. |
| (no backend change) | Endpoint + data are P4a; no new route, no new ws event. |

### Coexistence with future 86b2f019 (proposed-files / blueprint section)

86b2f019 will add a blueprint/proposed-files section to the SAME todo-detail surface. Both live
inside the `bridgeTab === 'detail'` column (BridgeDashboard.tsx:511-529), stacked vertically:
`TodoWorkerPanel` (LaneCallout/WorkerRunSummary + **WorkerRunStrip**) on top, then `TodoDetailView`,
and 86b2f019's section can mount as a sibling in that same fragment. No layout conflict — each is a
self-contained `m-3` card in the one shared card language (329741da). Keep WorkerRunStrip's section
label ("headless run") distinct from WorkerRunSummary's ("worker run") so the two run-records read
as separate sources, not duplicates.

## Risk / blocker check

- **NO blocker on the mount surface.** Contrary to the worry that the Bridge may lack a clean
  per-todo detail surface: it has one. `bridgeTab === 'detail'` + `selectedTodoId` +
  `TodoWorkerPanel` (BridgeDashboard.tsx:511-529) is a real, existing, single-todo detail column.
  WorkerRunStrip mounts cleanly inside `TodoWorkerPanel`.
- **leafId mapping is trivial** (leafId === todoId, verified) — no risk there.
- **Minor risk:** ws-only refresh is too coarse for per-node liveness, hence the gated poll. The
  poll MUST be gated (isActive && finalOutcome==null) or it becomes idle background polling on
  every selected todo — call it out in implement/review.
- **Minor:** every selected todo now fires one extra `/api/leaf-executor/run/:id` GET even for
  non-headless todos (returns `{ran:false}` cheaply). Acceptable; mirrors WorkerRunSummary's
  always-fetch behavior. If undesirable, gate the *initial* fetch on the todo having ever been
  in_progress — optional, not required.
