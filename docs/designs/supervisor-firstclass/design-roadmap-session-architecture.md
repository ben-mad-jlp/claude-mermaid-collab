# Roadmap Session Architecture — Options

## 0. What I found (current state)

- **Supervisor is a global singleton** (`skills/supervisor/SKILL.md §1`). Exactly ONE foreground session, the human's *planning + oversight cockpit*. Its identity is stored at `~/.mermaid-collab/supervisor.db` (`supervisor_identity`, id=1, with `serverId` for federation). It only ever: plans roadmaps, spawns workers via `roadmap_spawn_session` after explicit approval (§4), nudges/escalates, never answers prompts, never drives work.

- **Roadmap is per-project** (`src/services/roadmap-store.ts`): one DB per project at `<project>/.collab/roadmap.db`. Items carry `status`, `parentId`, `dependsOn[]`, and `sessionName` (the worker that owns the item). `computeWaves()` topologically sorts by `dependsOn`.

- **`roadmap_spawn_session` spawns ONE worker per ITEM** (`src/mcp/setup.ts:3479`). Per call it: seeds the named session's todos + links them to the item, `setItemSession(itemId → session)`, `addSupervised(project, session, 'roadmap')`, `addWatchedProject(project)`, then `launchAndBind` (tmux → claude → /collab → bind). So execution is **already isolated per item** in its own collab session — chatter does NOT flow through the supervisor session.

- **Supervised set is flat + global** (`supervisor-store.ts`): `supervised_session (project, session, source, serverId)`. `watched_project` is the iteration root. `supervisor_reconcile` (`setup.ts:3532`) loops watched projects → gets per-project session statuses → marks supervised rows, attaching `openTodos`; then folds in remote supervised sessions per peer. There is **no role/tier** on a supervised row — every supervised session is a flat "worker" candidate.

- **No per-project coordinator exists today.** The only tiers are: (1) the one global supervisor, (2) flat per-item workers. The roadmap "lives" in the project DB; the supervisor reads it directly via `roadmap_list/add/update`. The `RoadmapPanel` (`ui/.../RoadmapPanel.tsx`) is already **per-project** (takes a `project` prop, keys items by project).

## 1. Reframing the concern

The worry "roadmap execution muddies the supervisor session" is **mostly already solved for execution**: each approved item runs in its own bound collab worker. The actual chatter (file edits, tool calls, build output) never enters the supervisor's transcript.

So the real question is about **PLANNING + COORDINATION**, not execution:

1. **Planning** (decompose roadmap, set deps, decide what's `ready`) — today lives in the singleton supervisor, one shared cockpit across ALL projects.
2. **Coordination** (wave sequencing: when item A's worker finishes, mark dependents `ready` and spawn their workers; reconcile per-project progress; decide next approval) — today this is *implicit* and also sits on the supervisor. There is no actor that owns "drive project X's roadmap forward."

The supervisor explicitly **must not drive work** (§1). But wave coordination *is* a driving activity. Today it falls into a gap: either the human does it manually per turn, or the supervisor stretches its mandate. That gap — not execution noise — is the thing a "per-project roadmap session" would fill.

## 2. Option A — Status quo: singleton supervisor + per-item workers

Supervisor owns all planning + oversight across every project; each approved item gets its own worker; supervisor reconciles/nudges/escalates the flat worker set.

**Pros**
- Simplest; no new session tier, no schema change. Already shipped and working.
- Single cockpit = the human has one place to see everything across projects.
- Execution chatter is already isolated in workers — the literal "muddying" concern is minimal.

**Cons**
- Planning for N projects is interleaved in ONE transcript → the supervisor's *context* gets muddied (project A's roadmap discussion sits next to project B's), even though worker execution doesn't.
- Wave coordination has no owner. Marking dependents `ready` and spawning wave 2 either needs the human each turn or pushes the supervisor toward "driving," which §1 forbids.
- Doesn't scale: more projects/items = a busier singleton and a longer reconcile loop on every tick.

## 3. Option B — Per-project roadmap coordinator session

For each watched project, spawn ONE dedicated long-lived "roadmap coordinator" collab session (e.g. `roadmap-coordinator-<project>`), distinct from both the global supervisor AND per-item workers. The coordinator owns its project's roadmap: it computes waves, spawns item workers, marks dependents `ready` as deps complete, and reports project-level status up. The global supervisor oversees the **coordinators** (and still escalates to the human), not the individual workers.

**Pros**
- Clean separation: global supervisor = cross-project oversight + human gateway; coordinator = per-project planning/sequencing brain; workers = execution. Each transcript stays single-purpose.
- Wave coordination finally has an explicit owner — solves the §2 gap without expanding the supervisor's mandate.
- Scales per project; the supervisor's reconcile fan-out shrinks to N coordinators instead of all workers.
- Maps naturally onto the already-per-project roadmap DB and the already-per-project `RoadmapPanel`.

**Cons**
- New session tier ⇒ new role concept in `supervised_session` (e.g. a `role: 'coordinator' | 'worker'` column) and new reconcile routing (a coordinator going `waiting` means "advance the roadmap," not "nudge to keep coding").
- A coordinator *drives* work — which is exactly what the supervisor is forbidden to do. So the "no driving / always escalate" guardrail must be **re-homed**: workers still escalate to the human via the supervisor, but coordinators are now an autonomous driving layer. Approval-gating gets subtler (does the human approve each wave, or pre-approve the roadmap and let the coordinator run?).
- More moving parts, more tmux sessions, more failure modes (coordinator crash = project stalls). Federation: a coordinator must live on the same machine as its project's workers, while the supervisor is global — two-level `serverId` routing.
- Risk of duplicating supervisor logic (reconcile/nudge) at the project tier.

## 4. Option C — Per-item workers only, no coordinator; supervisor reads roadmap directly

Keep exactly two tiers (supervisor + workers). No dedicated planning/coordination session at all. The supervisor reads each project's roadmap DB directly (it already can) and, on its reconcile tick, advances waves itself: when a worker finishes, the supervisor marks dependents `ready` and (after the standing approval) spawns the next wave's workers.

**Pros**
- No new tier, minimal schema change. Reuses the per-project roadmap DB the supervisor already reads.
- Centralizes wave logic in one well-tested loop (`computeWaves` + reconcile) rather than reimplementing per project.
- One cockpit preserved.

**Cons**
- Makes the supervisor a **driver** of wave progression, in direct tension with §1's "never drive work." Needs an explicit, scoped exception: "advancing roadmap waves is allowed; authoring answers to a worker's questions is not."
- Planning context still interleaves across projects in the single transcript (same Option A muddying-of-context con).
- Reconcile tick grows with total item count.

## 5. Hybrid — Coordinator as a stateless role on the supervisor, materialized per project on demand

Don't spawn standing coordinator sessions. Instead give the supervisor an explicit, bounded **coordination sub-routine per project**, invoked only when a project's roadmap actually has waves to advance (a worker just finished, or the human said "go"). Optionally fence each project's planning into its own *artifact/thread* (a per-project roadmap doc + escalation namespace) so context is filed by project even though one session runs it. A standing per-project coordinator (Option B) is reserved only for large/active projects the human explicitly opts into.

**Pros**
- Gets Option B's "explicit wave owner" semantics and Option A's "one cockpit" without forcing a new standing session for every project.
- Incremental: start by adding the scoped coordination routine (Option C mechanics) + per-project filing; promote a project to a standing coordinator only when it earns it.

**Cons**
- The supervisor still technically drives waves (same §1 exception needed as C).
- "Sometimes a session, sometimes a routine" is two code paths to maintain.

## 6. Implications matrix

| Concern | A (status quo) | B (coordinator session) | C (supervisor drives) | Hybrid |
|---|---|---|---|---|
| Supervisor singleton identity | unchanged | unchanged (still 1 global) | unchanged | unchanged |
| Supervised set schema | flat, no change | **add `role` column** + coordinator rows | flat, no change | flat now; `role` only if a project is promoted |
| Reconcile / nudge routing | one policy | **two policies** (coordinator vs worker) | one policy + wave-advance step | one policy + optional wave-advance |
| `RoadmapPanel` (already per-project) | fits | fits best (show coordinator status per project) | fits | fits |
| Cross-machine federation | works | **harder** — coordinator pinned to project's machine, supervisor global ⇒ 2-level routing | works (supervisor already routes by serverId) | works; standing coordinator inherits B's complexity |
| Auto-launch policy (§4) | per-item, approval-gated | per-wave by coordinator; approval shifts to "approve the roadmap/plan" | per-wave by supervisor under a standing approval | per-wave routine under standing approval |
| §1 "never drive work" | intact | re-homed: coordinator drives, supervisor doesn't | **needs scoped exception** | needs scoped exception |

## 7. Recommendation — **C now, with a clear path to B (i.e. the Hybrid as the migration vehicle)**

**Do NOT spawn a separate standing collab session per project for roadmap execution at this stage.** Execution is already isolated in per-item workers, so a per-project session would not reduce execution muddiness — it would only add a coordination tier. The genuine gap is **wave coordination + per-project context filing**, and that gap does not yet justify the cost of standing coordinator sessions (new tier, two reconcile policies, two-level federation routing, extra crash surface).

Recommended sequence:

1. **Adopt Option C / Hybrid mechanics first.** Give the supervisor a bounded, explicit **wave-advance routine** per project: on reconcile, when a worker for item X reaches `done`, mark X `done`, recompute `computeWaves`, mark newly-unblocked items `ready`, and — under a **standing per-project "auto-advance" approval** the human grants once — auto-spawn the next wave's workers via the existing `roadmap_spawn_session`. This closes the coordination gap with the smallest change.
2. **Add a scoped exception to SKILL.md §1**: "advancing approved roadmap waves (status transitions + spawning the next wave's workers under a standing approval) is permitted; authoring answers to a worker's questions/decisions is still forbidden — those always escalate." This keeps the no-driving guardrail meaningful.
3. **File per-project context now**: keep a per-project roadmap doc/escalation grouping so the single cockpit's context is organized by project even while one session runs planning. (`RoadmapPanel` is already per-project, so the UI is ready.)
4. **Reserve Option B (standing per-project coordinator) as an opt-in upgrade** for a small number of large/hot projects, gated behind a `role` column on `supervised_session`. Only build it when a real project's roadmap is active enough that interleaving in the singleton genuinely hurts.

**Rationale:** B's clean three-tier model is architecturally attractive but front-loads the most cost (new tier, dual reconcile policies, pinned-to-machine coordinators vs a global supervisor, duplicated nudge/escalate logic) to solve a problem that, today, is mostly *context organization* rather than *execution isolation*. C delivers the missing capability (wave coordination) by extending the loop the supervisor already runs against the per-project roadmap DB it already reads, with one honest guardrail amendment. The Hybrid framing lets a busy project graduate to a dedicated coordinator later without re-architecting.

## 8. Concrete changes implied by the recommendation

- **`skills/supervisor/SKILL.md`**: amend §1 (scoped wave-advance exception); extend §5 reconcile loop with a wave-advance step (worker `done` → mark item `done` → recompute waves → mark unblocked `ready` → spawn next wave under standing approval); amend §4 to introduce a per-project **standing "auto-advance" approval** distinct from per-item approval.
- **`src/mcp/setup.ts`**: add a `roadmap_advance` tool (or extend `supervisor_reconcile`) that, given a project, completes a finished item, recomputes `computeWaves`, flips newly-ready items to `ready`, and returns the next-wave items to spawn. Reuse `roadmap_spawn_session` unchanged for the actual spawn.
- **`src/services/roadmap-store.ts`**: no schema change required (`status`, `dependsOn`, `sessionName`, `computeWaves` already suffice). Possibly add a per-project flag for "auto-advance approved."
- **`src/services/supervisor-store.ts`**: no change for C. For the deferred Option-B upgrade, add a `role TEXT DEFAULT 'worker'` column to `supervised_session` and treat `'coordinator'` rows under a separate reconcile policy.
- **UI**: `RoadmapPanel` already per-project; add a per-project "auto-advance: on/off" control and surface wave status. No new global view needed.
