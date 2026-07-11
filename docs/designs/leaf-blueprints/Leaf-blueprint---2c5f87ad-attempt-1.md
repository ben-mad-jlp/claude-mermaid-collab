# Blueprint — Group the daemon node-kind matrix by pipeline

## Goal
`DaemonNodesMatrix.tsx` renders all matrix rows flat. Group them into 4 labeled,
collapsible sections (Floor / Waves / Verify-CAD / Zen), each with a one-line
"fires when…" note. Floor expanded by default; the other three collapsed. The
group→kinds mapping + "fires when" copy lives next to `LEAF_NODE_KINDS` in
`src/services/leaf-executor.ts` (single source of truth, can't drift from the
executor) and reaches the UI through the existing node-profiles endpoint.

## Key facts (verified)
- `LEAF_NODE_KINDS` (11) and `NODE_KIND_DESCRIPTIONS` are at
  `src/services/leaf-executor.ts:314` / `:322`.
- The matrix endpoint at `src/routes/orchestrator-routes.ts:117` builds `rows`
  from `MATRIX_NODE_KINDS = LEAF_NODE_KINDS.filter(k => k !== 'summary')`
  (`orchestrator-routes.ts:25`) — so **`summary` is NOT sent to the UI today**.
  The Zen group therefore has no row in production; we still render its header +
  note so the user learns it exists (4 labeled groups always show).
- The UI (`ui/src/components/settings/DaemonNodesMatrix.tsx`) is a separate Bun
  bundle and must NOT import from `src/services`. It already consumes `desc`,
  `levels`, etc. from the endpoint JSON. So the group metadata is delivered the
  same way: a new `groups` array in the GET response.
- Execution-shape facts for the copy: `leafExecutionMode` (`leaf-executor.ts:749`)
  maps `type ∈ verify|cad-dogfood|dogfood → verify`, `reviewer → review`, else
  `code`; the Floor-vs-Waves split is `shouldUseFloor` (manifest single-file ⇒
  Floor, multi-file/`nonEnumerableFanout` ⇒ Waves).
- `ui/` is Bun-managed — never `npm install`.

## Changes

### 1. `src/services/leaf-executor.ts` — add the group constant (near line 334, after `NODE_KIND_DESCRIPTIONS`)
Add an exported, ordered constant. Keep it a plain literal so it's trivially
serializable and the route can spread it into JSON.

```ts
/** Pipeline grouping for the node-kind matrix editor (UI: DaemonNodesMatrix).
 *  The single source of truth for which kinds belong to which pipeline + when
 *  each pipeline actually fires. Ordered; Floor first. `defaultCollapsed` drives
 *  the matrix's initial expand/collapse. Kinds must partition LEAF_NODE_KINDS. */
export interface LeafNodeGroup {
  key: 'floor' | 'waves' | 'verify-cad' | 'zen';
  label: string;
  firesWhen: string;
  kinds: LeafNodeKind[];
  defaultCollapsed: boolean;
}

export const LEAF_NODE_GROUPS: LeafNodeGroup[] = [
  {
    key: 'floor', label: 'Floor', defaultCollapsed: false,
    firesWhen: 'Always — the default code-leaf path (blueprint → implement → review).',
    kinds: ['blueprint', 'implement', 'review'],
  },
  {
    key: 'waves', label: 'Waves', defaultCollapsed: true,
    firesWhen: "Only when a code leaf's blueprint manifest is multi-file / non-enumerable (!shouldUseFloor).",
    kinds: ['research', 'wimplement', 'verify', 'fix'],
  },
  {
    key: 'verify-cad', label: 'Verify / CAD', defaultCollapsed: true,
    firesWhen: 'Only when leaf.type ∈ verify | cad-dogfood | dogfood (build-assembly geometry gate) — never for ordinary backend/ui leaves.',
    kinds: ['driveplan', 'driveexec', 'report'],
  },
  {
    key: 'zen', label: 'Zen', defaultCollapsed: true,
    firesWhen: 'Session-summary loop, not a build leaf (not configurable here).',
    kinds: ['summary'],
  },
];
```

Optional hardening (recommended, cheap): a one-time dev assertion that
`LEAF_NODE_GROUPS.flatMap(g => g.kinds)` is a permutation of `LEAF_NODE_KINDS`
(covered instead by a unit test in step 4 to avoid runtime cost).

### 2. `src/routes/orchestrator-routes.ts` — surface groups in the GET response
- Import `LEAF_NODE_GROUPS` alongside the existing imports at line 20.
- In the GET `/api/orchestrator/node-profiles` response object
  (`orchestrator-routes.ts:144`), add a `groups` field. The UI only needs
  label/firesWhen/kinds/defaultCollapsed:

```ts
return Response.json({
  project,
  rows,
  groups: LEAF_NODE_GROUPS.map((g) => ({
    key: g.key, label: g.label, firesWhen: g.firesWhen,
    kinds: g.kinds, defaultCollapsed: g.defaultCollapsed,
  })),
  models: MODEL_CHOICES,
  // …unchanged…
});
```

(`rows` stays exactly as-is — still summary-filtered. The Zen group's `kinds`
includes `summary` but no matching row will exist; the UI renders the header +
note regardless.)

### 3. `ui/src/components/settings/DaemonNodesMatrix.tsx` — render collapsible groups
Refactor the single `<table>` body into one section per group.

- Add a `Group` interface + state:
  ```ts
  interface Group { key: string; label: string; firesWhen: string; kinds: string[]; defaultCollapsed: boolean; }
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  ```
- In `load()`, after `setRows(...)`: read `data.groups`, `setGroups(...)`, and
  seed collapse state from `defaultCollapsed` **only on first load** (don't clobber
  the user's manual toggles on re-pull — `update()` calls `load()` after every
  POST). Guard with a `collapseInitedRef` (useRef(false)) so the seed runs once:
  ```ts
  const list: Group[] = Array.isArray(data.groups) ? data.groups : [];
  setGroups(list);
  if (!collapseInitedRef.current && list.length) {
    setCollapsed(Object.fromEntries(list.map(g => [g.key, !!g.defaultCollapsed])));
    collapseInitedRef.current = true;
  }
  ```
- Extract the existing `rows.map((r) => …)` row-rendering into a
  `renderRow(r: Row)` helper returning the existing `<tr>…</tr>` verbatim (zero
  behavior change to provider/model/effort/resolves cells).
- Replace the single `<tbody>` with a fallback + grouped render:
  - If `groups.length === 0` (older server without `groups`): render the flat
    `rows.map(renderRow)` exactly as today (back-compat — keeps the existing 3
    provider/effort tests green even if they don't supply `groups`).
  - Else, for each group in order render a header row + (when expanded) its member
    rows. Use one `<tbody>` per group so the header spans columns:
    ```tsx
    {groups.map((g) => {
      const groupRows = rows.filter((r) => g.kinds.includes(r.kind));
      const isCollapsed = collapsed[g.key];
      return (
        <tbody key={g.key} data-testid={`node-group-${g.key}`}>
          <tr
            data-testid={`node-group-header-${g.key}`}
            className="cursor-pointer border-t border-gray-200 dark:border-gray-700"
            onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
          >
            <td colSpan={5} className="py-1 pr-2">
              <span className="text-2xs">{isCollapsed ? '▸' : '▾'}</span>{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200">{g.label}</span>{' '}
              <span className="text-3xs text-gray-500 dark:text-gray-400">— {g.firesWhen}</span>
              {groupRows.length === 0 && (
                <span className="text-3xs italic text-gray-400 dark:text-gray-500"> (not configurable here)</span>
              )}
            </td>
          </tr>
          {!isCollapsed && groupRows.map(renderRow)}
        </tbody>
      );
    })}
    ```
- `data-testid` set for the row (`node-row-${r.kind}`) and all cell controls stay
  unchanged, so existing tests keep matching. Collapsed groups simply omit their
  rows from the DOM (this is what the new default-collapsed test asserts).

Notes:
- Move `<thead>` to stay above the per-group `<tbody>` elements (valid: a table
  may have multiple `<tbody>`).
- The "Push to all projects" button block stays after `</table>`, unchanged.

### 4. Tests
**`ui/src/components/settings/DaemonNodesMatrix.test.tsx`** — add a new describe
block (keep the existing two green). Build a GET body that includes `groups`
(all 4) plus rows for floor + one waves kind (and a summary-less rows list, to
prove the Zen header still renders). Assert:
1. All 4 group headers render: `node-group-header-floor|waves|verify-cad|zen`.
2. Default-collapsed state: Floor's rows are present
   (`getByTestId('node-row-blueprint')`), but a Waves row is **absent**
   (`queryByTestId('node-row-research')` → null) and Verify/CAD + Zen rows absent.
3. Clicking a collapsed header (`fireEvent.click` on
   `node-group-header-waves`) reveals its rows (`node-row-research` now present).
4. Zen header renders with the "(not configurable here)" hint even though no
   `summary` row exists.
- Existing GET_BODY (no `groups`) → the fallback flat path still renders rows, so
  the two existing describe blocks pass unchanged.

**`src/routes/__tests__/orchestrator-routes.test.ts`** (optional but recommended):
add an assertion that the GET response `groups` has length 4 and that the union of
`groups[*].kinds` equals `LEAF_NODE_KINDS` (drift guard — proves the partition).

## Acceptance mapping
- 4 labeled groups → step 3 grouped render + step 1 constant.
- Non-floor collapsed by default → `defaultCollapsed` seed in `load()`.
- Constant near LEAF_NODE_KINDS, reuses NODE_KIND_DESCRIPTIONS for per-row text →
  `desc` already flows from `NODE_KIND_DESCRIPTIONS` via the endpoint; unchanged.
- vitest for grouping + default-collapsed → step 4.

## Verification
- `npm run test:ci -- src/routes/__tests__/orchestrator-routes.test.ts`
- UI vitest (Bun-managed): run the project's UI test runner for
  `DaemonNodesMatrix.test.tsx` (do NOT `npm install` in `ui/`).
- `npx tsc --noEmit` (backend) for the new exported constant + route field.

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/leaf-executor.ts",
    "src/routes/orchestrator-routes.ts",
    "ui/src/components/settings/DaemonNodesMatrix.tsx",
    "ui/src/components/settings/DaemonNodesMatrix.test.tsx"
  ],
  "tasks": [
    { "id": "group-constant", "files": ["src/services/leaf-executor.ts"], "description": "Add exported LeafNodeGroup type + LEAF_NODE_GROUPS constant (4 ordered groups, fires-when copy, defaultCollapsed) next to LEAF_NODE_KINDS." },
    { "id": "endpoint-groups", "files": ["src/routes/orchestrator-routes.ts"], "description": "Import LEAF_NODE_GROUPS and add a serialized `groups` field to the node-profiles GET response." },
    { "id": "ui-collapsible-groups", "files": ["ui/src/components/settings/DaemonNodesMatrix.tsx"], "description": "Consume `groups`; render one collapsible <tbody> per group with header + fires-when note; seed collapse from defaultCollapsed once; flat fallback when groups absent." },
    { "id": "ui-and-route-tests", "files": ["ui/src/components/settings/DaemonNodesMatrix.test.tsx", "src/routes/__tests__/orchestrator-routes.test.ts"], "description": "vitest: 4 headers render, non-floor collapsed by default, click reveals rows, Zen header shows with no summary row; route partition/drift guard." }
  ] }
```
