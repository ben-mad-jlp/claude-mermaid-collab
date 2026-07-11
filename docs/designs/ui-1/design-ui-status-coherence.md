# DESIGN — UI status coherence: one source per fact, one refresh path, surfaces are pure selectors

> Epic `d5b1ff4e`. Closes the desync matrix in `audit-ui-status-surfaces` (D1–D10, root causes R1–R4).
> Goal (acceptance): **the left column and the Bridge render identical escalation/worker state at any instant** — because both read the *same* store at the *same* scope through the *same* selector, refreshed by the *same* path.
> Constraint `b2fe36b1` (honored throughout): **no NEW WebSocket events, no polling.** Refresh is event-driven off the 5 existing events + a single bootstrap REST hydrate.

---

## 0. The decision that drives everything: coherence by *convergence on existing truths*, not a new megastore

The audit's instinct ("design ONE normalized status store") is right about the **end state** (one fact → one source → one selector) but wrong about the **mechanism** if read literally. Folding worker-liveness out of `subscriptionStore` into a brand-new store re-implements its three WS handlers (one will drift), gives reconnect-hydrate a second model to reconcile, and reintroduces "two truths" mid-migration. (Stress-tested with an independent skeptical review — this was its #1 risk-flag; ACCEPTED.)

So the coherent design is achieved by making the **existing** stores non-overlapping and adding a **shared selector layer** — not by minting a megastore:

| Fact | THE single source | What changes |
|---|---|---|
| **Worker liveness / status / context** | `subscriptionStore` (WS-native, composite-keyed `${serverId}:${project}:${session}`, multi-server aggregated) — **already correct** | **Nothing in the store.** The Bridge graph *stops* reading `supervisorStore.supervised` for liveness and reads `subscriptionStore` via the shared selector. (kills **R2 / D5 / D6**) |
| **Supervised membership** (which sessions are *watched*, not their liveness) | `supervisorStore.supervised` | Demoted to a pure membership list; **liveness is never read from it again**. |
| **Escalations (open)** | `supervisorStore.openEscalations` (new slice) | Split out of the one overwritten array; carries `serverId` per item. (kills **R1 / D2**) |
| **Escalations (resolved)** | `supervisorStore.resolvedEscalations` (new slice) | The resolved tab loads **only** here, so viewing it can never zero the open counts. (kills **D2**) |
| **Scope (fleet ⊃ project ⊃ session)** | one shared selector family `statusSelectors` | Every surface passes an explicit `scope`; no surface re-derives. (kills **R3 / D1 / D4 / D10**) |
| **Refresh** | one `hydrateStatus(serverIds)` + WS `ingest` | Replaces the 10s interval + every per-component `loadEscalations` useEffect. (kills **R1 / D3**) |

This is the minimal change that makes desync **structurally impossible**, because the two surfaces no longer have separate stores, scopes, or refresh cadences to drift between.

---

## 1. Canonical scope: AGGREGATED-WATCHED (server-stamped union)

Both surfaces operate over the **union across all watched servers**, then narrow with an explicit scope argument. `subscriptionStore` is already aggregated-multi-server; escalations become server-stamped to match. The active-server-only model (old `supervisorStore` REST) is abandoned as a *scope* — active-server is still used for invoke **routing**, never for deciding what to display.

```ts
type StatusScope =
  | { kind: 'fleet' }                              // all watched servers + projects
  | { kind: 'project'; project: string }           // one project, any watched server
  | { kind: 'session'; project: string; session: string };
```

One selector family, consumed identically by the left column and the Bridge:

```ts
// statusSelectors.ts — PURE, no store access inside; caller passes the slices.
selectOpenEscalations(open: Escalation[], scope: StatusScope): Escalation[]
selectOpenEscalationCount(open: Escalation[], scope: StatusScope): number
selectLiveness(sessions: Record<string, SessionStatus>, scope: StatusScope): LivenessView
selectSessionStatus(sessions, serverId, project, session): SessionStatus | undefined
```

**Coherence proof:** the left card's badge and the Bridge zone both call `selectOpenEscalations(store.openEscalations, scope)`. Same input array, same pure function → identical output at every render. The only freedom left is the `scope` argument, which is now *explicit and intentional* (a fleet badge vs. a project zone is a deliberate difference, not an accidental drift).

---

## 2. The one refresh path (no new WS events, no polling)

Two mechanisms, one owner (`useStatusSync`, mounted once at App root):

**(A) Incremental — WS `ingest`.** A single dispatcher folds the 5 existing events into the right slice:

| Existing WS event | Folds into | Action |
|---|---|---|
| `escalation_created` | `openEscalations` | upsert by id (server-stamped); **no REST reload** (replaces `App.tsx:564` blanket `loadEscalations`) |
| `claude_session_registered` | `subscriptionStore` | unchanged — keep existing `useWatchEvents` handler |
| `claude_session_status` | `subscriptionStore` | unchanged |
| `claude_session_context_update` | `subscriptionStore` | unchanged |
| `session_todos_updated` | `supervisorStore.todosByProject` | targeted `loadProjectTodos(project)` only (already the Bridge behavior) |

**(B) Bootstrap — `hydrateStatus(serverIds)`.** Runs **once on mount** and **once per WS reconnect** (not on an interval). Fetches open escalations for the watched servers and seeds `subscriptionStore` if empty. This is the *only* full REST read; it replaces SupervisorPanel's 10s `setInterval` and EscalationInbox's serverId/filter `useEffect`.

### 2.1 Reconnect-hydrate vs. ingest race — the mitigation (mandatory)

The dangerous hole: a reconnect `hydrateStatus` is in flight when an `escalation_created` arrives via `ingest`; the REST snapshot (older) then overwrites the newer WS upsert. (Independent review flagged this as the single biggest correctness risk — without a guard the redesign can *reproduce* the original symptom on every reconnect.) Mitigations, all required:

1. **Merge, never replace.** `hydrateStatus` performs a key-wise **upsert/merge** into `openEscalations`, keyed by escalation id — it must not assign a fresh array wholesale.
2. **Epoch guard.** `statusStore` holds a monotonically increasing `hydrateEpoch`. `hydrateStatus` snapshots the epoch before its REST call; on return it **discards** its result if a newer hydrate (or a `bumpEpoch()` on any ingest) started meanwhile. This prevents a slow in-flight snapshot from clobbering newer state.
3. **Local mutations are authoritative.** `resolve / decide / land` mutate the store synchronously (they already do) and a subsequent `hydrateStatus` merge must **not** resurrect an id the user just moved to resolved (the merge respects the locally-newer `resolvedAt`).

### 2.2 Known, accepted limitation (constraint-forced)

There is **no `escalation_resolved` WS event** and the constraint forbids adding one. Therefore a resolve performed by *another* actor (another window, the steward, server-side automation) is not seen by this client until the next reconnect/bootstrap hydrate. For a **local-first, typically single-user desktop app** this is acceptable; we document it rather than poll around it. Local resolves are seen instantly (§2.1.3). If this ever bites, the cheapest future fix is to let `escalation_created`'s existing broadcast also carry status transitions — *not* a new event.

---

## 3. Surfaces → pure selectors (the migration, ~20 consumers)

Every surface below drops its own load trigger / inline derivation and becomes a pure read of `(slice, scope)`. Citations are the audit's §1 rows.

### Left column
| Surface | Was | Becomes |
|---|---|---|
| `SupervisorPanel` | 10s interval loads + `/api/session-status` poll + `selectOpenEscalationsByProject` | mounts `useStatusSync` instead of its own interval; reads `selectOpenEscalations(open, {project})`; liveness via `selectLiveness(sessions, scope)` |
| `SessionCard` | presentational (already pure) | unchanged — keeps reading parent-passed `SessionStatus` (now sourced from the one liveness store) |
| `CommandBarBadge` | `selectFleetOpenCount(escalations)` over the shared array | `selectOpenEscalationCount(open, {fleet})` |
| `ProposedBadge` | `selectInboxRequirements` | unchanged (requirements out of scope; same store) |

### Bridge
| Surface | Was | Becomes |
|---|---|---|
| `NeedsYouZone` | `selectOpenEscalations(escalations, project)` + resync | `selectOpenEscalations(open, {project})`; resync delegates to `useStatusSync` |
| `BridgeEscalationInbox` | filters the `open` prop | unchanged (already pure over prop) |
| `EscalationInbox` | `useEffect` on serverId+filter → `loadEscalations(serverId,'resolved')` **overwriting open** | open tab reads `openEscalations`; **resolved tab loads into `resolvedEscalations` only** (the D2 fix); no shared-array overwrite |
| `ProjectRailRow` / `ProjectRail` | prop `escalationCount` | parent computes via `selectOpenEscalationCount(open, {project})` |
| `RequirementsInbox` | `selectInboxRequirements` | unchanged |
| **`FleetGraph` / `systemNodes` / `WorkerNode`** | liveness from `supervisorStore.supervised` (REST 10s, active-server) | **liveness from `subscriptionStore` via `selectLiveness`** — the core R2/D5/D6 fix |

### Docks / graph / inbox
| Surface | Becomes |
|---|---|
| `InlineEscalationDock` | `selectOpenEscalations(open, {session})` |
| `DrillDock` → child `EscalationInbox` | inherits the split-slice behavior |
| `TaskGraphView` | unchanged (session todos) |
| `systemNodes.deriveSystemNodes` | takes `selectLiveness` output; `hasOpenEscalation` reads `openEscalations` |
| `eventStreamStore` feed | unchanged here (R4/event-stream-dedup is a *separate* follow-up leaf, not this epic) |

**Out of scope for this design (separate leaves / epics):** R4 (event-stream dual-ID dedup + supervisor heartbeat — D7/D8/D9), requirements coherence (D10 is incidentally fixed by the shared-scope selector but requirements themselves aren't refactored here).

---

## 4. Target state shape (additive — minimal churn)

```ts
// supervisorStore.ts — escalations split; everything else untouched.
openEscalations: Escalation[];        // each carries serverId; the live "needs you" set
resolvedEscalations: Escalation[];    // resolved-tab only; loaded on demand, never zeroes open
hydrateEpoch: number;                  // race guard (§2.1)
// loadEscalations(serverId, 'resolved') → writes resolvedEscalations ONLY
// ingestEscalationCreated(e) → upsert into openEscalations + bumpEpoch
// resolve/decide/land → move id open→resolved locally (authoritative)

// subscriptionStore.ts — UNCHANGED (it is already the one liveness truth)

// statusSelectors.ts — NEW, pure
// statusSync.ts (useStatusSync hook) — NEW, the single owner of hydrate + ingest
```

No new store is introduced; `statusSelectors` + `useStatusSync` are thin, testable, and own the coherence guarantee.

---

## 5. Acceptance check (against the todo)

- **ONE source per fact** → §0 table: liveness = subscriptionStore; escalations = supervisorStore split slices; no fact has two stores. ✅
- **ONE refresh path** → §2 `useStatusSync` (WS ingest + single bootstrap hydrate), no interval, no new WS event, no poll. ✅
- **Consistent canonical scope used by BOTH surfaces** → §1 aggregated-watched + shared `statusSelectors`. ✅
- **Surfaces become pure selectors** → §3 migration table, ~20 consumers re-pointed. ✅
- **Left column and Bridge render identical state at any instant** → §1 coherence proof (same slice, same pure selector, same explicit scope) + §2.1 race guard so reconnect can't transiently diverge. ✅
- **Concrete impl task list** → §6. ✅

---

## 6. Implementation task breakdown (impl leaves under epic d5b1ff4e)

Sized file-disjoint where possible so the wave engine can parallelize; same-file work is chained by dependency. The planner promotes these to `ready`.

| # | Leaf | Files (primary) | Depends on | Notes |
|---|---|---|---|---|
| **L1** | Split `supervisorStore` escalations into `openEscalations` / `resolvedEscalations` slices (server-stamped); add `hydrateEpoch` + `ingestEscalationCreated` + epoch-guarded merge; resolve/decide/land move id open→resolved | `ui/src/stores/supervisorStore.ts` (+ test) | — | Foundation; the D2 + race-guard core |
| **L2** | `statusSelectors.ts` — pure `selectOpenEscalations` / `selectOpenEscalationCount` / `selectLiveness` / `selectSessionStatus` over `StatusScope` | `ui/src/lib/statusSelectors.ts` (+ test) | — | Pure, no store dep; parallel with L1 |
| **L3** | `useStatusSync` hook — single WS `ingest` dispatcher + `hydrateStatus(serverIds)` on mount + reconnect (merge + epoch); mount once at App root | `ui/src/hooks/useStatusSync.ts`, `ui/src/App.tsx` | L1 | Removes `App.tsx:564` blanket reload |
| **L4** | Re-point **liveness**: `FleetGraph` / `systemNodes` / `WorkerNode` read `subscriptionStore` via `selectLiveness`; `supervisorStore.supervised` demoted to membership only | `ui/src/components/supervisor/bridge/fleet/*`, `ui/src/components/supervisor/systemNodes.ts` | L2 | The R2/D5/D6 fix |
| **L5** | Migrate **escalation surfaces** to slices+selectors: `SupervisorPanel` (drop its interval), `CommandBarBadge`, `NeedsYouZone`, `EscalationInbox` (resolved→resolved slice), `ProjectRail*`, `InlineEscalationDock` | `ui/src/components/layout/SupervisorPanel.tsx`, `ui/src/components/supervisor/bridge/*`, `ui/src/components/supervisor/EscalationInbox.tsx`, `ui/src/components/layout/studio/InlineEscalationDock.tsx` | L1, L2, L3 | Largest; can sub-split by surface if a worker sizes it ≥4 independent files |
| **L6** | `type: reviewer` — completeness/coherence review of L1–L5: assert left-column and Bridge read identical slice+selector+scope; no residual ad-hoc `loadEscalations`/`supervised`-liveness reads | (read-only) | L1, L2, L3, L4, L5 | Integration gate per worker Step 1.6 |
| **L7** | `[LAND] UI status coherence → master` — `assigneeKind: human` | — | L1–L6 | Constraint `a383bc2c` |

**Parallelization:** L1 ∥ L2 first wave; L3 after L1; L4 after L2; L5 after L1+L2+L3; L6 gates all; L7 lands. L5 is the natural split point if a worker's size gate fires (it spans 6 surfaces across disjoint files).
