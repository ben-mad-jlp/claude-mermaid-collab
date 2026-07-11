# PCS Phase 5 — Wave 3 Polish (session todo #e180eef0)

Per-section scoping of the supervisor left column to the active project
(`uiStore.activeProject`). Built on the already-shipped Phase 5 tri-view; this
finishes the four deferred left-column polish pieces. **No commit made.**

## Approach

All project-scoped UI was added to the existing project-scope column
(`ProjectScopeSection.tsx`) following the established pattern there
(read `uiStore.activeProject`, fall back to `currentSession.project` →
first watched project; route supervisor REST through `serverScope`). The legacy
session-scoped panels (`SupervisorPanel`/`SubscriptionsPanel`) were intentionally
left untouched — they remain the global "Supervisor"/"Watching" sections at their
existing positions. Scoped equivalents live in the new project-scope column, which
is where the wireframe puts them and where the rest of the activeProject-driven
sections already live. This avoids destabilizing the always-visible legacy panels
(the original reason these were deferred).

## Pieces implemented

### 1. Sessions/Workers scoped to activeProject + Coordinator-status row
`ProjectScopeSection.tsx`. New collapsible **Sessions** section listing sessions
for the active project — the union of `supervisorStore.supervised` (project-filtered)
and `subscriptionStore.subscriptions` (project-filtered), deduped by session name.
Each row shows a 🔒 supervised indicator, context %, and a live status glyph; clicking
a row that maps to a known local `Session` calls `setCurrentSession`. Above the list,
a **Coordinator daemon status row** (green/grey dot + running/stopped) with a
Start/Stop button, wired to `loadCoordinator`/`setCoordinator`/`coordinatorByProject`
(the same store API the CoordinatorView uses).

### 2. This-project Escalations scoped list
`ProjectScopeSection.tsx`. The SYSTEM strip still shows the **global** open count;
added a collapsible **Escalations** section that lists open escalations filtered to
`e.project === activeProject`, each with a Jump (→ `setCurrentSession` to that
session) and Resolve (→ `resolveEscalation`) action. Section is hidden when the
scoped count is zero. Reuses the existing escalation store/route — no new component
or backend.

### 3. ArtifactTree scoped to activeProject  (SAFE GUARD — see Decisions)
`ArtifactTree.tsx`. The artifact tree is inherently **session**-scoped (it renders
the artifacts loaded for the current session; there is no "project artifacts"
concept — artifacts belong to a session). True cross-project artifact loading would
require fetching a foreign session's artifacts into a store keyed by the current
session, which is architecturally risky and out of scope for a polish wave. Instead,
implemented a **scope-mismatch guard**: when `activeProject` is set and differs from
`currentSession.project`, the tree renders a hint ("Items follow the active session,
which is in a different project than the one in scope") plus a one-click
"Switch to <session>" that points the current session at a session under the active
project. When in scope, behavior is unchanged.

### 4. Plan-row click → TodoDetailView + sync-project-to-session affordance
`ProjectScopeSection.tsx`. Plan rows are now buttons; clicking one
`upsertSessionTodo`s the project todo into the session store (project todos and
session todos share the backend `todo-store` table, but `TodoDetailView` reads from
`sessionStore.sessionTodos`, so seeding guarantees it renders even before that
session's todos are loaded) and opens a `todo-detail` preview tab — the same tab kind
`TodosTreeSection` uses. Added a **⇄ Sync** button on the PROJECT selector row,
shown when the active project differs from the current session's project; it switches
the current session to a session under the active project (disabled with an
explanatory tooltip when none exists).

## Files changed
- `ui/src/components/layout/sidebar-tree/ProjectScopeSection.tsx` — pieces 1, 2, 4:
  scoped Sessions + Coordinator row, scoped Escalations list, clickable plan rows →
  TodoDetailView, Sync affordance; extended load effects to fetch supervised +
  coordinator state.
- `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — piece 3: scope-mismatch
  guard + Switch-to-session shortcut.

No store/route/type changes were needed — all four pieces reuse existing
`supervisorStore` actions (`supervised`, `coordinatorByProject`,
`loadCoordinator`/`setCoordinator`, `resolveEscalation`, `loadProjectTodos`),
`sessionStore` (`setCurrentSession`, `upsertSessionTodo`), `tabsStore.openPreview`,
and the existing `/api/supervisor/*` REST surface.

## Decisions / assumptions
- Scoped sections were added to `ProjectScopeSection` rather than retrofitting the
  legacy `SupervisorPanel`/`SubscriptionsPanel`, per the deferral rationale (keep the
  always-visible legacy panels stable). The legacy panels stay global.
- Piece 3 (ArtifactTree) is deliberately a guard, not a cross-project loader —
  flagged above as the architecturally risky piece. The guard is the safe,
  consistent behavior; a true project-scoped artifact view would need a
  product/data-model decision and a backend "list artifacts for project" capability.
- A session row / escalation Jump only switches `currentSession` when a matching
  local `Session` object exists (same constraint the existing panels use for
  same-server navigation).

## Verification
- `npx tsc --noEmit` in `ui/` — **clean**.
- `cd ui && npm run build` — **clean** (only the pre-existing large-chunk warning).
- `npm run test:ci` on `ArtifactTree.test.tsx` + `ArtifactTree.clicks.test.tsx`:
  12/13 pass. The 1 failure (`ring-2` multiselect class assertion) is **pre-existing**
  — confirmed by stashing the ArtifactTree change and re-running (still fails). The
  jsdom relative-`fetch` URL errors are also pre-existing test noise. No
  ProjectScopeSection test exists. Per task instructions, the full-dir `bun test`
  ~96 false failures (vi.mock('bun:sqlite') leak) were not used; per-file UI tests
  were run instead.

## Repackage reminder
These are renderer (`ui/`) changes. For them to land in the installed desktop app,
the **app must be repackaged** (rebuild + repackage the Electron desktop bundle that
embeds the built `ui/dist`). A plain `npm run build` here only refreshes the dev/web
bundle.
