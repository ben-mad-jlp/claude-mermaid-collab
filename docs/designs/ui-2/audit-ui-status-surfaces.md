# Audit — UI status surfaces → store / selector / load-trigger / scope → desync matrix

Read-only audit (no code change). Goal: for every UI surface that shows escalations / worker
liveness / status, record which **store** it reads, which **selector**, what **load trigger**
refreshes it, and what **scope** it covers — then call out every pair that can disagree (the
"shows on the card but not the Bridge" class of bug).

---

## 1. Store inventory (the facts behind every surface)

| Store | Fact it holds | Populated by | Scope |
|---|---|---|---|
| `supervisorStore` | watched projects, `escalations[]` (flat), `todosByProject`, `supervised[]`, `config`, `liveness`, `requirementsByProject`, coverage/objects/bom | **REST only** — `/api/supervisor/*` via `load*`; **no WS** writes the escalation/todo lists | **active routing server** (`serverScope = activeId ?? 'local'`); multi-project aggregate inside it |
| `subscriptionStore` | per-session heartbeat status (`active/waiting/permission/unknown/stale`), context %, lastUpdate, pid | WS `claude_session_status`, `claude_context_update` (routed from App.tsx) + localStorage hydrate (coerced `stale`) | **per-server, multi-project** — key `serverId:project:session` |
| `questionStore` | interactive Claude question/response | `receiveQuestion()` (caller); reply → WS `submit_question_response` | global (not project/session scoped) |
| `proposalStore` | doc proposal/comment approve-reject | local in-memory only, **no WS, no persistence** | global ephemeral (item-scoped) |
| `eventStreamStore` | ring buffer (cap 500) of normalized activity events | **all WS msgs** via `pushFromWs()` (`escalation_created`, `session_created`, `claude_*`, `drive.*`, `supervisor_nudge`, artifact churn) + `backfillFromAudit` | active project (filtered by caller) |
| `projectStore` | registered projects, selection | REST `projectsApi.*`, no WS | global (all registered) |
| `sessionStore` | `sessionTodos` (current session), sessions, currentSession | session-change + WS `session_todos_updated` | **current session only** |
| `uiStore` | `mode`, `activeProject`, layout/collapse | local client state | local |

**Load-bearing fact:** the authoritative `escalations[]` and `todosByProject` lists live in
`supervisorStore` and are **REST-poll only** — `escalation_created` (and todo churn) reach
`eventStreamStore` (the activity ring), **not** the lists that the inbox/badges render from.
So escalation/todo freshness everywhere depends on a poll or a resync; there is no live push.

---

## 2. Desync matrix — surface × (store, selector, trigger, scope)

### A. Escalation / "needs-you" surfaces (all read `supervisorStore.escalations`)

| Surface | Selector | Load trigger | Scope |
|---|---|---|---|
| **SupervisorPanel** (left column, per-project count) | `selectOpenEscalationsByProject(escalations)` | **10s `setInterval`** → `loadEscalations(serverScope)` *(no status filter)* | **fleet** — all watched projects |
| **ProjectRailRow** (Bridge rail badge) | `counts[project]` from `selectOpenEscalationsByProject` (computed upstream in SupervisorPanel) | inherits SupervisorPanel's 10s poll + `resyncBridge` | **fleet** (one row per project) |
| **CommandBarBadge** (ModePill, all modes) | `selectFleetOpenCount(escalations)` | whatever last wrote `escalations` (poll or resync) | **fleet** — sum |
| **NeedsYouZone** (Bridge) | `selectOpenEscalations(escalations, project)` | `BridgeDashboard` mount / WS **reconnect** / manual ↺ → `resyncBridge()` → `loadEscalations(serverScope,'open')` | **single active project** |
| **EscalationInbox / BridgeEscalationInbox** | pre-filtered prop from NeedsYouZone (`selectOpenEscalations`) | none of its own — receives prop; mutations optimistic | **single active project** |
| **InlineEscalationDock** (studio) | inline `escalations.filter(open && project===cur && session===cur)` | rides SupervisorPanel's 10s poll | **single session** (current project+session) |

> Within this family the *counts* are parity-tested: `selectOpenEscalations(p).length === byProject[p]`,
> and CommandBarBadge `= sum(byProject)`. They cannot disagree **on the same array at the same scope**.
> The divergences below come from **scope** and **trigger**, not the selectors.

### B. Requirements ("proposed") surfaces

| Surface | Selector | Load trigger | Scope |
|---|---|---|---|
| **ProposedBadge** (ModePill) | `selectInboxRequirements(requirementsByProject[project], project)` | refreshed by `resyncBridge` → `loadRequirements(serverScope, project)` | **single active project** |
| **RequirementsInbox** (Bridge) | `selectInboxRequirements(...)` (same) | `resyncBridge` mount/scope-change; **no WS** | **single active project** |

### C. Worker-liveness / status surfaces

| Surface | Store · selector | Load trigger | Scope |
|---|---|---|---|
| **SupervisorPanel** (session rows) | `supervisorStore.supervised` + `subscriptionStore.subscriptions` merged; live WS preferred over polled, **15-min staleness cutoff** | 10s `loadSupervised` + 10s `/api/session-status` poll + WS `claude_session_status`/`claude_context_update` | supervised = **server-wide**; subscriptions = **per-server:project:session** |
| **SessionCard** | — (pure presentational, props only; click → per-server terminal/browser side-effects) | parent supplies `SessionCardData` | single session (routes to card's `serverId`) |
| **systemNodes** (`deriveSystemNodes` / `supervisorLiveness`) | stateless over `config`+`supervised`+`subscriptions`+`escalations` | caller (BridgeDashboard) supplies inputs | aggregate of supervised (or single project if scoped) |
| **ModePill** | `uiStore.mode` only | local keyboard/click | local |

### D. Todo / graph surfaces

| Surface | Store · selector | Load trigger | Scope |
|---|---|---|---|
| **TaskGraphView** | `sessionStore.sessionTodos` | `useTaskGraph` + WS `session_todos_updated` | **current session only** |
| **DrillDock** | — (props: `subscriptions`, `todos`) | parent | single active server, project-scoped by parent |
| **humanInboxSelectors** (`selectHumanInbox`, `humanInboxCounts`) | stateless over passed `todos` (caller pulls `supervisorStore.todosByProject[project]` **or** `sessionStore.sessionTodos`) | caller's load path | **current project** (caller pre-scopes) |
| **funnel.ts** (`funnelCounts`, `bucketTodo`…) | stateless over passed `SessionTodo[]` | caller (BridgeDashboard `funnelCounts(excludeEpics(todos))`) | whatever the caller passed |

---

## 3. Divergences — the pairs that can disagree

These are the concrete "shows on the card but not the Bridge" (and related) desyncs.

### D1 — **Active-project vs fleet scope** (THE headline "card but not Bridge")
- **Card side (fleet):** `ProjectRailRow` badge + `CommandBarBadge` + SupervisorPanel per-project count show escalations for **every** watched project.
- **Bridge side (single project):** `NeedsYouZone` / `EscalationInbox` only render `selectOpenEscalations(escalations, **activeProject**)`.
- **Result:** an open escalation in a *non-active* project shows on its rail row / fleet badge but is **absent from the NeedsYouZone list** until the user switches `activeProject` to it. Same shape for **ProposedBadge vs RequirementsInbox** (badge counts active project; if `activeProject` and `currentSession.project` differ, the badge and the inbox can even point at different projects — ProposedBadge uses `activeProject ?? currentProject`).

### D2 — **Poll trigger vs resync trigger, gated on SupervisorPanel being mounted**
- `supervisorStore.escalations` is refreshed by **two** independent paths writing the **same array**:
  (a) SupervisorPanel's **10s `setInterval`** poll, and (b) BridgeDashboard's **`resyncBridge`** (mount / WS-reconnect / manual ↺ / `session_todos_updated`).
- Because there is **no WS path into `supervisorStore.escalations`** (escalation_created only feeds `eventStreamStore`), a newly created escalation appears **only after a poll or a resync**.
- If the **left column (SupervisorPanel) is not mounted/visible**, the 10s poll does not run, so the Bridge updates **only** on its own resync triggers — a fresh escalation can sit unshown on the Bridge while (when the panel *is* mounted) it would appear on the card within 10s. **This is the literal "shows on the card but not the Bridge" timing bug.**

### D3 — **Status-filter clobber on the shared array** (latent, not visible)
- Poll calls `loadEscalations(serverScope)` → server returns **all statuses**; resync calls `loadEscalations(serverScope, 'open')` → **open only**. Both do a wholesale `set({ escalations })`.
- The array contents therefore **flap** (resolved escalations enter on a poll, vanish on a resync). Client selectors re-filter to `open`, so the rendered set stays consistent — but any future consumer that reads non-open statuses from this array will see non-deterministic contents depending on which loader fired last.

### D4 — **Liveness (subscriptionStore) vs escalation (supervisorStore) are different facts in different scopes**
- "Needs you" via **escalation** (supervisorStore, server-wide REST poll) and "needs you" via **session status** `waiting`/`permission` (subscriptionStore, per-`serverId:project:session`, live WS + 10s poll + 15-min staleness) are surfaced by different components and can disagree: a session blocked on a permission prompt shows in SupervisorPanel's row status but raises **no** escalation card; an escalation with a since-recovered worker shows a card while the row reads `active`. The **15-min staleness cutoff** can also paint a row `stale` while its escalation is still `open`.

### D5 — **Todo scope: per-project inbox vs current-session graph**
- `humanInboxSelectors` count over `supervisorStore.todosByProject[project]` (per watched project), while **TaskGraphView** reads `sessionStore.sessionTodos` (**current session only**), refreshed by a different trigger (`session_todos_updated` WS vs supervisor REST poll). The human-inbox depth and what the graph shows as ready/in-progress-for-a-human can therefore diverge across a session boundary or between poll cycles.

### D6 — **subscriptionStore scope key includes `serverId`; supervised uses a `'local'` sentinel**
- `subscriptionStore` keys on `serverId:project:session`; supervised rows from the coordinator are stamped `serverId='local'` and aliased back to the real local server in SupervisorPanel. A mismatch between the sentinel and the real server id is a latent lookup-miss path for merging live status onto a supervised row (handled today by a serverId-agnostic fallback lookup, but it is a divergence point worth noting).

---

## 4. Acceptance summary

- ✅ Complete table covering all named status surfaces (SupervisorPanel, SessionCard, NeedsYouZone,
  EscalationInbox/BridgeEscalationInbox, ProjectRailRow, funnel.ts, InlineEscalationDock, DrillDock,
  ModePill + CommandBarBadge/ProposedBadge, TaskGraphView, humanInboxSelectors, RequirementsInbox,
  systemNodes) → §2, with store / selector / trigger / scope each.
- ✅ Explicit divergence list (§3): **D1 active-vs-fleet scope** is the primary "shows on the card but
  not the Bridge" cause; **D2 poll-vs-resync + panel-mount dependency** is the secondary (timing) cause;
  D3–D6 are supporting latent/cross-fact divergences.

**Root cause in one line:** the card surfaces read the escalation list at **fleet scope on a 10s poll**,
the Bridge inbox reads the **same array at single-active-project scope refreshed only by resync**, and
**no WS event updates that shared list** — so scope + trigger, not the (parity-tested) selectors, are
where the two disagree.
