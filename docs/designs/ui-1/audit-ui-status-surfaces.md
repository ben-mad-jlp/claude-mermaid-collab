# AUDIT — UI status surfaces → store / selector / load-trigger / scope → desync matrix

> Read-only audit (no code change). Maps EVERY UI surface that shows escalations / worker-liveness / status to the store it reads, the selector that derives the displayed fact, what refreshes it, and what scope it covers — then lists the pairs that can disagree (the "shows on the card but not the Bridge" class of bug).
>
> Worktree: `.collab/agent-sessions/worktrees/ui-1`. Epic `d5b1ff4e`. Method: parallel read-only mapping of the left column, the Bridge, the docks/graph, and the six stores; citations are `file:line`.

---

## 0. The two source-of-truth stores (the root of every divergence)

Two stores answer almost every status question, and they are built on **incompatible keying + load models**. That mismatch is the engine behind every divergence in §3.

| Store | Holds | Keying | Load model | Server-switch behaviour |
|---|---|---|---|---|
| **supervisorStore** | escalations, supervised[], liveness, requirements, todosByProject, roadmap, audit | escalations/supervised are **flat global lists, NOT keyed by server**; the rest keyed by **project** | **REST pull**, `load*(serverId, …)`; **overwritten wholesale** per fetch (`supervisorStore.ts:14-20, 273-361, 570-579`) | NOT self-refreshing — a caller must re-invoke `load*` on `activeServerId` change. Array re-points to whatever server loaded last. |
| **subscriptionStore** | claude session status (active/waiting/permission/unknown), contextPercent, stale | **composite key `${serverId}:${project}:${session}`** → **aggregated across all watched servers** (`subscriptionStore.ts:37-46`) | **WS push** via WatchAggregator → `useWatchEvents` (`claude_session_registered/_status/_context_update`) + localStorage hydrate at boot (`subscriptionStore.ts:48-83,135-162`) | Keeps aggregated multi-server data; never cleared on switch. |

Supporting stores: **questionStore** (singleton `currentQuestion`, WS `claude_question`, no server/project key); **proposalStore** (in-memory, keyed by itemId, no persistence/sync); **eventStreamStore** (500-cap ring buffer, WS push + audit backfill, aggregated across all projects/servers); **projectStore** (registered-project list, REST pull, global).

**Two consequences that recur below:**
1. **supervisorStore.escalations is one global array, refreshed by whoever called `loadEscalations` last — with whatever `(serverId, status)` that caller chose.** A `status='resolved'` or different-server load **wholesale-overwrites** the array every other open-escalation surface reads.
2. **Worker liveness has two independent truths:** `subscriptionStore` (WS-live, multi-server, composite-keyed) vs `supervisorStore.supervised`/`liveness` (REST 10s, active-server, project-keyed). The left card and the Bridge graph do not read the same one.

---

## 1. Surface → (store, selector, load-trigger, scope) matrix

### Left column
| Surface | Store(s) | Selector | Load trigger | Scope |
|---|---|---|---|---|
| **SupervisorPanel** `layout/SupervisorPanel.tsx` | supervisorStore (escalations, supervised, config, liveness, watchedProjects) + subscriptionStore + sessionStore | `selectOpenEscalationsByProject(escalations)` (`:219`); `combineCardStatus()` (`:38-43`) | **10s `setInterval`** → loadSupervised/Escalations/Config/Liveness/Projects, on mount + `serverScope` change (`:170-185`); **separate 10s poll** of `GET /api/session-status` (`:329-397`) | **ACTIVE routing server** (`serverScope = activeId ?? 'local'`, `:126`); per-project counts across watched projects |
| **SessionCard** `layout/SessionCard.tsx` | none (pure presentational; `SessionCardData` prop) | none — `sub.status/contextPercent/stale` props | parent-driven (SupervisorPanel) | inherits parent: active-server subscription **or** polled status fallback |
| **ModePill › CommandBarBadge** `bridge/CommandBarBadge.tsx` | supervisorStore (escalations, todosByProject) | `selectFleetOpenCount(escalations)` (`escalationSelectors.ts:39-44`) | none of its own — rides whoever last loaded escalations | **FLEET-WIDE** — counts ALL open across ALL projects |
| **ModePill › ProposedBadge** `bridge/ProposedBadge.tsx` | supervisorStore.requirementsByProject + uiStore.activeProject + sessionStore | `selectInboxRequirements(requirementsByProject[project], project)` (`requirementSelectors.ts:27-31`) | rides parent loads of requirements | **ACTIVE project** (`activeProjectPref ?? currentSession.project`) |

### Bridge
| Surface | Store(s) | Selector | Load trigger | Scope |
|---|---|---|---|---|
| **NeedsYouZone** `bridge/NeedsYouZone.tsx` | supervisorStore.escalations | `selectOpenEscalations(escalations, project)` (`escalationSelectors.ts:17-19`) | `resyncBridge()` on **WS reconnect** + **`session_todos_updated`** msg + manual ↺ (`BridgeDashboard.tsx:108,133-146`) | **ACTIVE project** (`project = activeProjectPref ?? currentSession.project ?? supervised[0].project`) |
| **BridgeEscalationInbox** `bridge/BridgeEscalationInbox.tsx` | supervisorStore (decide/resolve/land actions) | `escalations.filter(e=>e.status==='open')` on the **prop** (`:38`) | none — receives `open` prop from NeedsYouZone; keyboard drain | ACTIVE project (inherited) |
| **EscalationInbox** `supervisor/EscalationInbox.tsx` | supervisorStore.escalations + loadEscalations | raw + local filter by status **and** kind (`:51-58`) | **`useEffect` on `serverId` + `statusFilter`** → `loadEscalations(serverId, open\|resolved)` (`:46-49`) | **GLOBAL** (no project filter) on the ACTIVE server; **loads `resolved` when toggled** |
| **ProjectRailRow** `bridge/ProjectRailRow.tsx` | none (prop `escalationCount`, `idleWithWork`) | none (`red = escalationCount>0`, `:24-25`) | parent ProjectRail computes | per-project (parent-scoped) |
| **RequirementsInbox** `bridge/RequirementsInbox.tsx` | supervisorStore.requirementsByProject | `selectInboxRequirements(requirements, project)` (`:27-31`) | parent `loadRequirements(serverScope, project)` + keyboard | **ACTIVE project** |
| **funnel.ts / escalationSelectors.ts / requirementSelectors.ts** | none (pure) | bucketing + open-count selectors | n/a | caller-parameterised |

### Docks / graph / inbox
| Surface | Store(s) | Selector | Load trigger | Scope |
|---|---|---|---|---|
| **InlineEscalationDock** `layout/studio/InlineEscalationDock.tsx` | supervisorStore.escalations | filter `status==='open' && project===currentSession.project && session===currentSession.name` (`:27-32`) | global store mutation only (no own load) | **CURRENT session** (project+session) |
| **DrillDock** `stream/DrillDock.tsx` | props (escalations/todos) → renders EscalationInbox child | child reads supervisorStore.escalations | parent loads; child `useEffect` on serverId | ACTIVE server (prop `serverScope`) |
| **TaskGraphView** `task-graph/TaskGraphView.tsx` | sessionStore.sessionTodos | passes to FleetGraph | `useTaskGraph(project, session)` | **CURRENT session** |
| **FleetGraph WorkerNode** `bridge/fleet/nodes/WorkerNode.tsx` | deckStore.selectedNodeId; liveness via prop | `dotColor(d.liveness)` (`:15-24`) | parent `useFleetGraph` (derives from todos+subs) | parent-scoped |
| **systemNodes.ts** `supervisor/systemNodes.ts` | none (pure `deriveSystemNodes`) | `hasOpenEscalation(p,s) ? 'escalation' : mapStatus(subFor(p,s)?.status)` (`:38`); `supervisorLiveness()` 120s stale (`:79-89`) | caller supplies input | **optional project filter** (`inScope`, `:30`) |
| **humanInboxSelectors.ts** `todos/humanInboxSelectors.ts` | none (pure) | `assigneeKind==='human' && ACTIONABLE.has(status)` (`:24-26`) | caller passes todos | project-scoped input |
| **eventStreamStore feed** (EventStream/StudioTicker) | eventStreamStore | `fromWsMessage` / `fromAuditEntry` taxonomy (`eventTaxonomy.ts:240-420`) | **WS push** (every msg) + audit backfill | **AGGREGATED** all projects/servers |

---

## 2. WebSocket / load-trigger map (who writes what, when)

| Fact | WS event | Writes to | Also pull-loaded by |
|---|---|---|---|
| Escalation opened | `escalation_created` (`handler.ts:99`) → App reloads (`App.tsx:564`, `loadEscalations(activeServerId, 'open')`) | supervisorStore.escalations **+** eventStreamStore (`escalation.opened`) | SupervisorPanel 10s; EscalationInbox on serverId/filter; Bridge resync on reconnect/todos |
| Worker liveness / status / context | `claude_session_registered/_status/_context_update` → WatchAggregator → `useWatchEvents` | **subscriptionStore** (composite-keyed) **+** eventStreamStore (`worker.crashed`/`context.high`) | supervisorStore.supervised/liveness via REST 10s (NOT WS) |
| Supervisor/steward heartbeat | — (none) | — | `loadLiveness`/`loadStewardIdentity` REST only |
| Question | `claude_question` (`App.tsx:912-918`) | questionStore (singleton) | — |
| Todos changed | `session_todos_updated` | triggers Bridge `resyncBridge` (`BridgeDashboard.tsx:143-146`) | SupervisorPanel 10s |

**The asymmetry that matters:** escalations refresh on **three different cadences** writing one global array — SupervisorPanel's **10s interval**, the Bridge's **WS-reconnect/`session_todos_updated`** `resyncBridge`, and App's **`escalation_created`** handler. There is **no shared refresh**; the array's contents at any instant reflect the **last** loader's `(serverId, status)` choice.

---

## 3. DESYNC MATRIX — pairs that can disagree over the same fact

Each row is a fact shown in ≥2 places that can **legitimately diverge** because the places differ in **scope** or **trigger** (or read **different stores**).

| # | Fact | Surface A (scope · trigger · store) | Surface B (scope · trigger · store) | Why they diverge | Symptom |
|---|---|---|---|---|---|
| **D1** | Open escalation count | **CommandBarBadge** — FLEET-wide · rides last load · supervisorStore | **NeedsYouZone** — ACTIVE project · WS-reconnect resync · supervisorStore | Different **scope** over one array: a badge counts an escalation in project P, but the Bridge zone only shows the active project | **"Badge says 1, the Needs-You zone is empty"** (escalation belongs to a non-active project) |
| **D2** | Open escalations (the array itself) | **EscalationInbox** — loads `status='resolved'` on toggle, GLOBAL, on serverId/filter `useEffect` | **All open-count readers** (CommandBarBadge, NeedsYouZone, SupervisorPanel, InlineEscalationDock) | `loadEscalations(serverId,'resolved')` **wholesale-overwrites** the global array → every open-count selector momentarily sees 0 open | **Cards/badges blink to 0 open** while the resolved tab is viewed, until the next open-load |
| **D3** | Open escalation count | **SupervisorPanel** — ACTIVE server · 10s interval · supervisorStore | **Bridge NeedsYouZone** — ACTIVE project · WS-reconnect/todos · supervisorStore | Different **trigger** (10s poll vs event) → up to ~10s skew, and an **active-server vs active-project** scope mismatch | One refreshes while the other is stale; "left column updated, Bridge didn't" |
| **D4** | Escalation visibility | **InlineEscalationDock** — CURRENT session · supervisorStore | **NeedsYouZone** — ACTIVE project · supervisorStore | session-scope ⊂ project-scope: a project escalation for another session shows in the zone but not the inline dock (and vice-versa for current-session) | "Bridge shows it, the inline dock under my terminal doesn't" |
| **D5** | Worker liveness / session status | **SessionCard** (left) — subscriptionStore, **WS-live**, composite-keyed, multi-server **+** `/api/session-status` poll | **Bridge FleetGraph / systemNodes** — supervisorStore.supervised, **REST 10s**, active-server, project-keyed | **Different stores + different triggers + different keying.** WS status updates the card instantly; the graph waits for the 10s `loadSupervised` on the active server | **"Shows active on the card but not (or stale) in the Bridge graph"** — the canonical bug |
| **D6** | Session status after server switch | **SessionCard** — subscriptionStore keeps aggregated multi-server data | **SupervisorPanel / Bridge** — supervisorStore re-points to the newly active server only | supervisorStore is not server-keyed and is overwritten per active server; subscriptionStore retains all servers | After switching servers, left cards still show other-server sessions; the supervised list/graph drop them |
| **D7** | Supervisor "running" badge | **systemNodes.supervisorLiveness()** — 120s stale window (`:79-89`) | **SupervisorPanel** liveness dot — `loadLiveness` 10s, no WS push | heartbeat is **REST-pull only**; two surfaces apply different staleness windows (120s vs poll cadence) | Supervisor shows "running" in one place, "stale/unknown" in another |
| **D8** | Context % high | **SessionCard** ctx warn (>68/78, subscriptionStore) | **eventStreamStore** `context.high` (>80, WS) | different thresholds + the event stream is a one-shot narration, the card is live state | Ticker fires "context high" but the card's gauge shows a different band |
| **D9** | Escalation in activity feed | **eventStreamStore** — aggregated, WS `escalation.opened` + audit backfill, ID `esc-${id}` vs `audit-${id}` | **supervisorStore.escalations** — authoritative open/resolved | dedupe is by event id only; the two ID schemes for the same escalation **don't dedupe** (`eventTaxonomy.ts:354-420`) | The same escalation can appear twice in the stream, or linger in the feed after being resolved in the store |
| **D10** | Requirements / proposed count | **ProposedBadge** — ACTIVE project, requirementsByProject | **RequirementsInbox** — ACTIVE project, same store | Same store+scope **but** badge rides ambient loads while the inbox triggers its own `loadRequirements`; if active-project pref ≠ current session project they key different buckets | Badge count ≠ inbox length when `activeProjectPref` and `currentSession.project` disagree |

### Root causes (the divergences collapse to four)
- **R1 — One global escalations array, three uncoordinated load cadences + a `status` filter that overwrites it wholesale.** Drives **D1, D2, D3**. (supervisorStore not keyed by server/status; `loadEscalations` replaces the array.)
- **R2 — Two independent liveness truths** (subscriptionStore WS-live multi-server vs supervisorStore REST-10s active-server). Drives **D5, D6** — *the* "card but not Bridge" bug.
- **R3 — Scope ladder over the same store** (fleet ⊃ active-project ⊃ current-session) with no single scoped selector shared across surfaces. Drives **D1, D4, D10**.
- **R4 — Pull-only heartbeat + dual-ID event stream** (no WS heartbeat; taxonomy IDs don't reconcile with the store). Drives **D7, D8, D9**.

---

## 4. Acceptance check
- **Complete table covering all status surfaces** → §1 (left column ×4, Bridge ×6, docks/graph/inbox ×8) + §0 stores + §2 WS map. ✅
- **Explicit list of divergences that cause "shows on the card but not the Bridge"** → §3 D1–D10, with **D5/D6** the literal card-vs-Bridge liveness desync and **D1/D2** the badge-vs-zone escalation desync; root causes collapsed to **R1–R4**. ✅

**Recommended follow-up leaves** (out of scope for this audit, for the planner): (a) key supervisorStore.escalations by server **and** stop status-filtering the shared array (fixes R1/D1-D3); (b) make the Bridge graph read worker liveness from subscriptionStore, or unify on one liveness store (fixes R2/D5-D6); (c) one shared `selectOpenEscalations(scope)` used by every surface (fixes R3); (d) reconcile event-stream IDs with store ids + add a WS heartbeat (fixes R4/D7-D9).
