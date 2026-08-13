# Canonical vocabulary

**This is `spec-canonical-vocabulary`** — the source of truth named by decision
`45a0d906` (*"Canonical vocabulary: workspace (durable) vs session (live runtime);
pool/slot/worker; type≠profile"*, status `active`, authored 2026-06-05).

That document was lost: only the 36-byte stub
`docs/designs/supervisor-firstclass/.spec-canonical-vocabulary.meta.json` survived, and
its body was never committed. This file restores it and is its permanent home.

**How to use it.** The canonical column is the allowlist. The retired column is the
denylist, mechanically enforced on changed files by `src/services/vocab-lint.ts`
(CI: `.github/workflows/vocab-lint.yml`). A term is only canonical once it appears here;
a synonym is only retired once it has a lint rule. Anything in **§7 Open collisions** is
neither — it needs a decision before it can be renamed.

---

## 1. The work model

The nouns of the graph. `kind` is a NOT-NULL column on `todos`; a role is **never**
inferred from a title (`src/services/todo-kind.ts`).

| Term | Meaning |
|---|---|
| **mission** | The top unit of driven work. Converges when every acceptance criterion is met and independently verified. `kind='mission'`. |
| **criterion** | One acceptance criterion of a mission — a falsifiable statement about the product. Missions converge criterion by criterion. Table: `mission_criterion`. |
| **epic** | A branch-bearing unit of work serving one or more criteria (`servesCriterionIds`). Owns a git branch; lands as a unit. `kind='epic'`. |
| **leaf** | The executable unit: one todo a worker builds end to end. `kind='leaf'`. A leaf with children is still a leaf. |
| **land** | A `kind='land'` node — childless work that is *not* a leaf. Distinct from the **land** verb (§5). |
| **gate** | A pass/fail check that admits or blocks work. `kind='gate'` as a node; also the general mechanism (§4). |
| **todo** | The generic graph node. Every mission/epic/leaf/land/gate is a todo. Table: `todos`. |
| **workgraph** | The dependency graph over todos. Read it with `inspect_workgraph`. |
| **bucket** | A todo marked `isBucket` (Explore, Bugfix, Feature) — a filing destination, excluded from convergence work and mission parenting. Orthogonal to `kind`. |
| **work request** | an unplanned item filed into one of the three typed bucket epics: `explore` (a question to investigate), `bugfix` (a defect to repair), `feature` (a capability to add). The lane is carried by the todo's `bucketType` column (`ui/src/lib/workRequestRegistry.ts:3` `WorkRequestType`), with an optional `frictionLayer` tag (`domain` / `orchestration` / `operational`) as metadata only. The legacy `inbox` bucketType normalizes to `explore` (`normalizeWorkRequestType`, `ui/src/lib/workRequestRegistry.ts:34`). **Work request** is the canonical user-facing name for what the UI's work-requests surface renders. |

## 2. Namespace and runtime

Decision 45a0d906 (B1) **freed the word "session"**. This rename is the one stage that
was never executed — see §7.

| Term | Meaning |
|---|---|
| **project** | An absolute path to a repo root. The top-level scope for todos, missions, and config. |
| **workspace** | The durable `(project, name)` namespace — what persists under `.collab/`. **Canonical since 45a0d906.** Retires "collab session". |
| **session** | A **live Claude process** bound to a workspace. Nothing durable. |
| **worker** | The ephemeral process that runs exactly one claimed todo. Retires "lane" and "pool session". |
| **pool** | A typed group of concurrency slots. |
| **slot** | One concurrency position within a pool. |
| **type** | The todo routing key that selects a pool. Retires "pool-type" / `poolType`. |
| **profile** | A composed capability × tech-pack × persona. **Never** conflated with `type` — they are distinct concepts (45a0d906 B3). |
| **watched project** | A project the user has asked to see. Table: `watched_project`. Already canonical in code. |
| **watched session** | A session the user has asked to see. **Canonical (decided 2026-08-04).** Retires "supervised session" AND the client-side "subscription". One list, server-side. |

**"Watched" is the single word for user attention.** It replaces two parallel concepts
that used to hide each other — see §7b. Daemon-spawned workers are *not* watched: nobody
asked for them. Their provenance lives in the worker ledger (§7b).

## 3. Drivers

| Term | Meaning |
|---|---|
| **daemon** | **Canonical.** The always-on process that claims ready todos, builds them through workers, and reconciles the graph. **Retires "coordinator" and "orchestrator"** (decided 2026-08-04). |
| **conductor** | Drives ONE active mission: reads per-criterion derived actions, serves every open gap, and lands build-green + verify-green epics. Directs the players; never hand-edits source. Orchestration node kind `conductor`. |
| **planner** | Decomposes one mission criterion into an epic and its leaves. The only role that promotes todos to `ready`. Orchestration node kind `planner`. |
| **forge** | Derives a mission's acceptance criteria from a design doc. Orchestration node kind `forge`. |

The three **orchestration node kinds** (`forge`, `conductor`, `planner`,
`src/services/node-kinds.ts`) run ABOVE the per-leaf pipeline and deliberately never
participate in per-leaf dispatch.

> Note: "orchestration node kind" is the existing name for this registry. It survives as
> a *category* label even though **orchestrator** is retired as a name for the daemon.
> Renaming it is optional cleanup, not a correctness issue.

## 4. The leaf pipeline

The node kinds a leaf runs through (`LEAF_NODE_KINDS`, `src/services/leaf-executor.ts`),
in dispatch order:

`blueprint` · `implement` · `review` · `research` · `wimplement` · `verify` · `fix` ·
`driveplan` · `driveexec` · `report` · `summary`

| Term | Meaning |
|---|---|
| **blueprint** | The plan a leaf writes before implementing. A known cost sink. |
| **review** | The maker≠checker node on a leaf's own diff. |
| **verify** | The independent gate. For missions, one reviewer per criterion checked against ground truth. |
| **base gate** | The pre-build check that the epic's base is green. A red base blocks every epic project-wide. |
| **land gate** | The pre-merge check that the epic's diff introduces no regression. |
| **verify panel** | The multi-verdict independent check over a mission's criteria. A HOLD is a vacuous falsifier — grade at HEAD. |

## 5. Lifecycle verbs

| Term | Meaning |
|---|---|
| **land** | Merge an epic's branch to the trunk. Stamps `landedAt` and a `Collab-Todo:` trailer. |
| **forward-integrate** | Merge the trunk INTO an epic branch (`--no-ff`, never rebase) to clear base drift. |
| **adopt** | Take an existing branch and make it an epic (`adopt_branch_as_epic`). |
| **park** | Stop a leaf without failing it — infra fault, not a spec defect. Reversible via `reset_todo`. |
| **drop** | Remove a todo from the graph. Cascades to non-terminal children. |
| **escalation** | A blocking question surfaced to a human, or resolved by the daemon internally. `audience: 'human' \| 'internal'`. |
| **friction** | A recorded instance of the harness hurting. Feeds trend analysis; the input to a mission. |
| **drain** | A campaign that clears an accumulated backlog (e.g. of base-red epics) to zero. |

## 6. Retired terms — the denylist

Enforced by `src/services/vocab-lint.ts` on changed files only.

| Retired | Canonical | Enforced |
|---|---|---|
| "pool session", "lane" | **worker** | ✅ lint rule `pool-session`, `lane` |
| "pool-type", `poolType` | **type** | ✅ lint rule `pool-type` |
| "collab session" | **workspace** | ✅ lint rule `collab-session` |
| "coordinator", "orchestrator" (as the build daemon) | **daemon** | ❌ *decided 2026-08-04; not yet enforceable — see below* |
| "supervised session", "subscription" (as user attention) | **watched session** | ❌ *decided 2026-08-04; blocked on the merge in §7b* |
| "supervisor" (as a role or subsystem) | *(split by concern — §7a)* | ❌ *not a rename; needs decomposition* |
| "steward" | *(concept removed)* | ❌ *no rule yet — residue in `steward-proof.ts` + 10 files* |
| "triage" (as a work-request surface) | **work request** | ✅ enforced by ui/src/lib/workRequestVocabGate.test.ts |

**Why the `daemon` rule can't be added yet.** The lint's allowlist model assumes the
retired term survives in a *handful* of un-migrated files. It doesn't here:

| term | files in `src/`, `ui/src/`, `scripts/` |
|---|---|
| `coordinator` | 168 |
| `orchestrator` | 113 |
| union | **243** |

Allowlisting 243 files would make the rule vacuous, and adding it *without* the allowlist
would red the base gate for any change touching them — which per this project's failure
history reds every epic base project-wide. **The rename must land first, then the rule.**
Sequence: rename `coordinator-*.ts` → `daemon-*.ts` and fold `orchestrator-config.ts` into
it, shrink the residue to a small allowlist, then add the lint rule to hold the line.

Files on `LEGACY_ALLOWLIST` still carry pre-migration vocabulary on purpose; remove an
entry once that file is migrated.

## 7. The supervisor cluster

| | status |
|---|---|
| 7a. "supervisor" as a name | **decided** — decomposed by concern, not renamed |
| 7b. `supervised_session` | **decided** — merged into **watched session** |
| 7c. `session` → `workspace` | **open** — still needs a migration design |

7a and 7b are decided but **not yet built**. Nothing is renamed until the merge in 7b
lands, because renaming without merging preserves the defect under a better name.

### 7a. "supervisor" — a name with no current referent

`supervisor-store.ts` owns **10 tables spanning four unrelated concerns**:

| Concern | Tables |
|---|---|
| Project registry | `watched_project` |
| Session supervision | `supervised_session` |
| Escalations | `escalation`, `escalation_decision`, `supervisor_decision` |
| Control-plane config & audit | `supervisor_identity`, `supervisor_config`, `supervisor_pause`, `supervisor_audit` |

It also surfaces publicly as **11 MCP verbs** (`supervisor_nudge`, `supervisor_reconcile`,
`supervisor_pause`, `supervisor_audit_list`, `supervisor_watchdog_scan`,
`supervisor_list_supervised`, `supervisor_clear_session`, `supervisor_next_decision`,
`supervisor_resolve_decision`, `supervisor_pause_status`, `supervisor_resume`) and as the
UI's **Supervisor panel**.

**Resolution (2026-08-04): "supervisor" is not renamed — it is decomposed.** It is a
v1/v2-era grab-bag, not a role anyone names today. Each concern goes to its canonical home:

| Concern | Goes to |
|---|---|
| `watched_project` | **watched project** — already correctly named |
| `supervised_session` | **watched session** (§7b) |
| `escalation`, `escalation_decision`, `supervisor_decision` | **escalation** — already correctly named |
| `supervisor_identity`, `supervisor_config`, `supervisor_pause`, `supervisor_audit` | **control plane** |

The 11 MCP verbs and the UI's "Supervisor panel" are the visible residue. Renaming shipped
MCP verbs is a breaking change and needs its own migration design with back-compat aliases;
the panel is free to rename immediately.

### 7b. `supervised_session` → `watched session` — a MERGE, not a rename

**Decided 2026-08-04.** Today two parallel lists both mean "the user wants to see this
session", and they **hide each other** — which is the entire bug:

| | storage | scope | effect |
|---|---|---|---|
| "Watching" | `localStorage` (`session-subscriptions`) | per-machine | shows the card |
| "supervised" | `supervised_session` (server db) | shared | **hides** that same card |

`SubscriptionsPanel.tsx:127-129` drops any subscription whose session is supervised, and
`:177` then hides it from the picker as already-subscribed. A live session becomes
invisible in both places at once. Adding a project auto-supervises every session in it
(`SupervisorPanel.tsx:545-553`), so this happens without anyone asking.

**Renaming the table alone preserves the bug under a better name.** The two lists must
become ONE:

- **One list, server-side** — `watched_session`, matching `watched_project`. The
  `localStorage` store becomes a cache of the server list, not a second source of truth.
- **The hide-filter is deleted, not ported.** With one list there is nothing to hide from.
- **The `source` column goes away.** *(Corrected 2026-08-04 — see below.)* The table has
  only ever done ONE job.

**The "daemon provenance" job is already dead code.** An earlier draft of this section
claimed `launchWorker` writes `source:'spawn'` rows. It does not. Verified:

- The **only** `addSupervised(...)` call in the repo is `supervisor-routes.ts:502` (the
  HTTP route). `coordinator-live.ts` imports the symbol and never calls it.
- Every caller passes `source:'manual'`. `'spawn'` and `'roadmap'` exist only as members
  of the TypeScript union — nothing writes them.
- Therefore `FleetGraph.tsx:162` `spawnedSessions` is **always an empty Set**, and its
  filter is dead.
- Live data confirms it: the table holds 2 rows, both `manual`.

So this is a straight merge of two human-attention lists, plus a dead-code deletion — not
a provenance migration.

**Load-bearing consumers** — two need re-sourcing, two need deletion:

| Consumer | What it needs `supervised` for | Action |
|---|---|---|
| `SupervisorPanel.byProject` (`:425-477`) | the entire project→session grouping and the `Nλ` count | **re-source** → watched sessions |
| `BridgeDashboard` (`:139`, `:317`) | project session list; default project | **re-source** → watched sessions |
| `FleetGraph` / `useFleetGraph` (`:162`) | `source==='spawn'` — always empty | **delete** the dead filter |
| `systemNodes.ts` (`:81-82`) | Workers nodes, fed from human-supervised rows | **re-source** → watched sessions (it never saw workers) |

**Migration input is trivial:** 2 rows, both `source='manual'`, both `serverId=''`.
`launchProject` is marked *"legacy (tmux naming); no longer written"* in the schema
(`supervisor-store.ts:223`) and is dropped.

**Open sub-question:** making watched sessions server-side means watching a session on one
machine watches it everywhere. That is consistent with `watched_project` (already shared)
and is the recommended behaviour, but it is a behaviour change from today's per-machine
Watching list.

### 7c. `session` → `workspace` — the rename that never ran

Decision 45a0d906 staged this third and explicitly required a **migration design first**
(back-compat aliases + path migration), *"not a blind rename"*. It touches persisted
`.collab/sessions/` paths, the public HTTP API, and 8 MCP verbs that carry `session` in
their name: `assign_session_todo`, `clear_completed_session_todos`, `list_session_todos`,
`remove_session_todo`, `reorder_session_todos`, `toggle_session_todo`,
`update_session_todo`, `supervisor_clear_session`.

Until it runs, `session` remains overloaded in code: it means the durable namespace
almost everywhere, and the live process only in `session-status`. **This is the single
largest source of vocabulary confusion in the project.**

## 8. Enforcement

- Detector: `src/services/vocab-lint.ts` — pure, no IO, deterministically testable.
- CI wrapper: `scripts/vocab-lint.ts` — feeds it **changed files only**, so untouched
  legacy code never reds the build.
- Suppression: `vocab-lint-ignore-line`, `vocab-lint-ignore-next-line`,
  `vocab-lint-disable-file`.

**A term added to this table without a lint rule will re-drift.** Adding the rule is part
of adopting the term, not a follow-up.
