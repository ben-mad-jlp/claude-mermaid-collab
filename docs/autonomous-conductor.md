# Autonomous Conductor — design & roadmap

Turning mission-forge and the conductor into server-side machinery: a collab doc becomes an
approved mission becomes a driven, landed convergence — with a human only ratifying the plan.

## Decisions (locked)

1. **Conductor is a per-tick NODE, not a persistent session.** It reuses the node invoker
   (`invokeNode`) like the `forge` node — one bounded pass per tick, restart-safe.
2. **Trigger = the orchestrator tick + event nudges** (epic update, mission-status change, inbox
   change), debounced by a mission status/criteria fingerprint (like the mission-loop nudge) so a
   tick with no material change is a no-op.
3. **The conductor lands** — autonomous `land_epic`, no human land-gate for conductor-initiated
   lands. Guarded: a land requires the mission be **converged + VERIFY-green** (green mechanical +
   independent verify), never a bare tick.
4. **Per-project on/off toggle**, like the orchestrator level.

## What has shipped

- **`forge_mission`** — deterministic instantiation of a mission's whole *constitution*:
  constraints → active constraint records (prompt-injection payload C → every build node),
  rejected alternatives → decision records (payload D), digest → `.collab/project-digest.md`
  (payload A). `missionConstitutionHealth` (surfaced in `get_mission`) is the enforcement teeth.
- **`forge_mission_from_doc`** — a server-side `forge` NODE (model/effort configurable per-project
  via `node_profile_override` for kind `forge`, overridable per call) reads a collab doc, surveys
  the repo, and emits a structured mission spec, which `forge_mission` instantiates as an
  **UNAPPROVED** mission (status `unapproved`, inactive, constraints PROPOSED).
- **Mission approval** — first-class `unapproved` mission status (inverse `awaitingApprovalSince`
  field, no backfill). `approve_mission` clears it, activates the mission, and ratifies its
  proposed constraints so they inject. Health then reads `ok`.

So today: **doc → forge node → unapproved mission in the list → human approves → constitution
live.** Judgment is the node's; instantiation is machinery.

## The pipeline (target)

```
collab design doc
   └─ forge_mission_from_doc (forge NODE, per-project model/effort)
        └─ mission: status 'unapproved'  ──human approve_mission──▶  approved + active
                                                                        │
                                        conductor NODE (per-tick, per-project toggle, it LANDS)
                                                                        │
   for the approved+active mission, each tick (debounced):
     • criterion action 'discover' → spawn conductor node → create_epic/add_leaves, approve for the daemon
     • criterion action 'building' → wait (the Orchestrator build+land daemon does the work)
     • criterion action 'verify'   → run the independent VERIFY gate (reviewer per criterion, maker≠checker)
     • all criteria met + epics landed → converge
     • may trigger PLANNER nodes for roadmap planning
```

## Roadmap

- **Phase 1 — doc→forge node + mission approval. ✅ DONE (shipped).**
- **Phase 2 — the conductor node. HAND-BUILD (bootstrap).** A new `conductor` pass in the
  orchestrator tick, gated by a per-project `conductor` toggle; new `conductor` node kind (model/
  effort via the override matrix). Reads `listCriteriaWithActions`, serves `discover` gaps via a
  conductor node that files+approves epics, runs VERIFY on `verify` gaps, and lands a
  converged+verify-green mission. Debounced by the status fingerprint. **The conductor cannot
  conduct its own creation** (mission-forge Step 3), so this piece is hand-built; once it exists,
  Phases 3–5 can be *forged as missions and driven by it* — real dogfooding.
- **Phase 3 — planner-node triggering.** A `planner` node kind the conductor invokes to plan a
  roadmap as work-graph todos with deps.
- **Phase 4 — UI: node model-settings matrix.** Surface the new `forge`/`conductor`/`planner`
  kinds in the `node_profile_override` matrix (model/effort/provider per project).
- **Phase 5 — UI: conductor status + conversation logs.** On/off + which mission + phase +
  per-criterion progress; the conductor node transcripts (already written by the invoker) viewable.

## Risks / open items

- **Autonomous landing** is the irreversible-action line. Precondition: converged + VERIFY-green;
  never land on a bare tick. Keep the mechanical gate PRE-land. (See `land-authority`, the derived
  land barrier, and `reference_land_epic_needs_human_permission` — the conductor is the sanctioned
  exception, gated by the verify precondition.)
- **Debounce is essential** — an undebounced conductor pass on every epic update would thrash and
  burn tokens. Reuse the mission status/criteria fingerprint the mission-loop already computes.
- **Bootstrap**: hand-build Phase 2 before forging Phases 3–5.
