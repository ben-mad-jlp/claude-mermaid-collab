# Research: collab ↔ bsync first-class peering — ADDITIONAL work items

Scope: grounded gaps found by reading real code in both repos, BEYOND the four already-identified
plan points (per-project `.collab/project.json` manifest; Coordinator-side authoritative gate;
bsync typed metric vocabulary; on-disk session/project enumeration / DOGFOOD #1). Each item cites the
file/function that makes it true. Items flagged collab-side / bsync-side / manifest-seam, and tied to
an existing DOGFOOD/CAD-VERIF todo or marked NEW.

> Verification note: I could NOT locate a canonical "DOGFOOD #1–#7 + CAD-VERIF" enumerated list as
> todos rows — `.collab/todos.db` in collab holds an unrelated `worker-live`/`frontend-1` set, and the
> bsync `todos.db` is the CAD-feature backlog. The DOGFOOD numbers below are taken from the **inline
> code/skill comments** that reference them (e.g. coordinator-live.ts L213 "DOGFOOD #6", worker
> SKILL.md L62 "DOGFOOD #4/#5", L31 "DOGFOOD #5"). Where I tie an item to a DOGFOOD number it is by
> that in-code citation, not a todo row. Said explicitly so nothing is over-claimed.

---

## P0 — Blocks the 4-point plan from actually working

### 1. The acceptance gate is worker-self-certified; there is NO Coordinator-side gate to make authoritative (CONFIRMS + scopes plan point #2)
- **Why it matters.** Plan point #2 ("Coordinator-side authoritative gate") is not a *hardening* of an
  existing gate — there is **no** coordinator gate at all today. The verdict is produced entirely inside
  the worker and passed *in* as a string the coordinator trusts verbatim.
- **Evidence.** `src/services/coordinator-live.ts` `completeTodo: async (project, id, acceptance) => { const r = await completeTodo(project, id, acceptance); … }` (L104–128) — `acceptance` ('accepted'|'rejected') is an argument, the coordinator never re-runs anything. The actual gate lives in the **skill prose**: `skills/worker/SKILL.md` Step 3 (tsc + scoped tests, L27–40) and Step 3b (CAD geometry gate, L42–55), and the worker simply calls `complete_todo(..., acceptance: "accepted")` (L87–94). `planCoordinatorTick` (`coordinator-core.ts`) only plans claims/releases — no verification.
- **Shape of fix.** A `runGate(project, todo, committedArtifactRef)` in the coordinator path that reads the
  project manifest's `gateCommand`, runs it against the **committed** artifact (post-commitPushPR sha),
  and *overrides* the worker's self-report. The worker's report becomes advisory.
- **Side.** collab-side (+ manifest-seam for the command). **Relates to:** plan #2 (this is the missing
  substrate for it).

### 2. There is no project manifest seam anywhere — profiles are a hard-coded in-code registry (CONFIRMS plan point #1 is fully net-new)
- **Why it matters.** Plan point #1 assumes an extension point to plug a manifest into. There is none:
  `grep` for `project.json` / `manifest` / `contextPrompt` across `src/` returns **zero** hits.
- **Evidence.** `src/config/agent-profiles.ts`: `AGENT_PROFILES` is a frozen `Record` of 6 hard-coded
  profiles (L39–46), every one with the **identical** `allowedTools` string `Bash Edit Write Read ${MCP}`
  and `runtimeMode:'edit'`. There is **no `contextPrompt` field** on `AgentProfile` (L16–23) and **no
  per-project override path** — `resolveProfile(type)` (L51–54) only indexes this static map. `PATH_RULES`
  (L61–67) are TS/web regexes (`.tsx`, `routes/`, `services/`) with **no CAD path awareness** (`.step`,
  `parts/`, `assembly/` all fall through to `default`).
- **Shape of fix.** Load `.collab/project.json` at coordinator/worker-launch time; merge declared
  profiles (with new `contextPrompt` + `allowedTools` fields) over the static registry; let the manifest
  add path rules. `AgentProfile` needs a `contextPrompt` field added.
- **Side.** collab-side + manifest-seam. **Relates to:** plan #1 (the seam it needs).

### 3. bsync's metric vocabulary + deterministic verdict already exist in code but are UNREACHABLE — not an MCP verb (CONFIRMS plan point #3, and it is half-built)
- **Why it matters.** Plan point #3 wants bsync to "publish a typed metric vocabulary" and have the gate
  speak it. The vocabulary AND a deterministic pass/fail verdict are **already written** —
  `workspace_vol_cm3`, `median_cond`, `n_dims_moved`, `frac_near_singular`, `median_manipulability`,
  `reach_bbox_mm` — but they are dead code with no exposure.
- **Evidence.** `bsync-tools/bsync/fitness.py`: `assess_fitness()` (L71–103) returns exactly that typed
  dict; `fitness_verdict(metrics, *, min_vol_cm3, max_median_cond, max_frac_singular)` (L106+) is "the
  gate-runner's threshold check" producing pass/fail + reasons. **But** `grep fitness` across
  `src/build123d_ocp_mcp/` returns **nothing** — there is no `@mcp.tool` wrapper, it is not in the
  deferred MCP tool list (no `mcp__build123d-ocp-mcp__assess_fitness`), and nothing in `src/` calls it.
- **Shape of fix.** (bsync) Expose `assess_fitness` / `fitness_verdict` as MCP verbs returning the typed
  dict; (manifest) reference those metric keys + thresholds in `project.json` `metrics`; (collab) the
  gate-runner calls the verb and compares against manifest thresholds.
- **Side.** bsync-side (expose) + manifest-seam (thresholds). **Relates to:** plan #3 (it is ~50% done
  but stranded).

### 4. The change-set gate + diff/review path cannot handle binary STEP/PNG deliverables (NEW)
- **Why it matters.** CAD deliverables are binary STEP/PNG. The worker's Step-3 code gate is text/tsc/
  tests; the human review surface is a raw text patch. Binary artifacts produce "Binary files differ" and
  vanish from review — there is no diff, no thumbnail, no before/after.
- **Evidence.** `src/routes/worktree-diff.ts` `handleWorktreeDiffAPI` (L72–88) builds the review payload by
  running `git diff --no-color HEAD -- <path>` (L80,L83) and returning `.stdout` as `patch`. For a `.step`/
  `.png` git emits the bare "Binary files … differ" line → empty/uninformative review. The worker's own
  CAD gate (SKILL.md Step 3b L46–50) validates geometry **via live MCP session state**, NOT the committed
  bytes, so a valid-in-session part can still commit a corrupt/empty STEP and the review surface won't show it.
- **Shape of fix.** (collab) detect binary paths in worktree-diff; for STEP/PNG emit a structured
  artifact-card (size, sha, "open in viewer" deep-link, or a rendered thumbnail) instead of a text patch.
  Pair with a Coordinator gate (item #1) that re-imports the **committed** STEP (`step_load` round-trip)
  rather than trusting the live session.
- **Side.** collab-side (+ bsync render/round-trip verb). **NEW.**

---

## P1 — Needed for the self-improving + first-class-peer story

### 5. Friction-signal persistence is write-only into a void — `.collab/attempts/` is never created or read (NEW; DOGFOOD #4 prereq is unbuilt)
- **Why it matters.** Self-improving profiles (DOGFOOD #4) need queryable attempt/struggle data. The
  worker is told to emit a rich friction note (outcome, retryReason, layer=collab|bsync, failingVerb,
  failingReturn) — but it goes to a flat per-todo JSON file that **nothing ingests**.
- **Evidence.** `skills/worker/SKILL.md` Step 4·0 (L59–85): "Write a friction note … Path:
  `<pwd>/.collab/attempts/<todoId>.json`". On disk **neither** `claude-mermaid-collab/.collab/attempts/`
  **nor** `build123d-ocp-mcp/.collab/attempts/` exists (both `ls` → ENOENT). `grep attempts` across `src/`
  finds only unrelated retry-loop locals — **no reader**. The DB has a `retryCount INTEGER` column
  (`todo-store.ts` L145, bumped in `reclaimClaim` L397) but **no** `retryReason` / `layer` / friction
  columns — the attribution data (collab vs bsync layer) is captured nowhere durable.
- **Shape of fix.** (collab) a `.collab/attempts.db` (or columns on todos) + an ingest step in the
  coordinator's `completeTodo`/reap path that reads the worker's note (or have the worker call a new
  `record_attempt` MCP verb instead of Writing a file), so layer-attribution and retry causes are
  queryable per profile/project.
- **Side.** collab-side (+ MCP verb). **NEW (DOGFOOD #4 prereq).**

### 6. Permission-stall class: bsync CAD verbs are on NO profile allowlist; nothing injects them (CONFIRMS DOGFOOD #6 follow-up; NEW fix)
- **Why it matters.** Workers launch `runtimeMode:'edit'` and PROMPT for non-allowlisted MCP tools. A CAD
  worker must call `mcp__build123d-ocp-mcp__*` (and `mcp__bsync-desktop__*`) verbs — none of which are on
  any profile's `allowedTools` — so a `type: cad` worker stalls at a permission prompt, which DOGFOOD #6's
  detector then flags as an idle stall (treating a structural mis-config as a runtime anomaly).
- **Evidence.** `src/config/agent-profiles.ts` `MCP = 'mcp__mermaid mcp__plugin_mermaid-collab_mermaid'`
  (L32) is the ONLY MCP token in every profile (L40–45); no `mcp__build123d-ocp-mcp` / `mcp__bsync-desktop`
  anywhere. The allowlist is enforced via `resolveWorkerProfile` → `ensureSession({allowedTools,…})`
  (`coordinator-live.ts` L161,L166). The stall detector `detectStalls` (L212–254) sees the resulting
  idle-at-prompt pane and files an escalation.
- **Shape of fix.** Per-project manifest declares the profile's `allowedTools` including the project's MCP
  server tokens; the launcher merges them in. (Ties directly to item #2 — same seam.)
- **Side.** collab-side + manifest-seam. **Relates to:** DOGFOOD #6 (root-cause class behind the stalls).

### 7. Worker write-isolation (DOGFOOD #5) is NOT wired into the launch path, and the shared-tree model is hostile to binary CAD + dependent reads (NEW / DOGFOOD #5)
- **Why it matters.** The whole worktree machinery exists but the coordinator/pool launch path **does not
  use it** — workers run in the *shared* repo tree, by the skill's own admission. For CAD this is acute:
  (a) sibling lanes' uncommitted large binary STEP/PNG pollute every `git status` the gate runs; (b) a
  dependent CAD todo must read a *prior* todo's committed STEP output, but the shared-tree model has no
  defined "read the upstream artifact" handoff.
- **Evidence.** `WorktreeManager` (`src/agent/worktree-manager.ts`) implements `ensure` (worktree add,
  L107), `commitPushPR` (`git add -A` → commit → push, L255–364) — but `grep` for it across `src/` finds
  it imported ONLY by `agent/session-registry.ts`; **neither `coordinator-live.ts` nor `worker-pool.ts`
  reference it**. The worker skill states the reality: "the pool runs many workers in the **SAME git
  working tree**" (SKILL.md L31) and spends L33–36 teaching the worker to manually filter sibling-lane
  files out of `git status --porcelain` / `tsc` / tests to avoid "contamination" false-rejects. Current
  branch is literally `fix/dogfood-5-worktree-isolation`, confirming the gap is open.
- **Shape of fix.** Route `launchWorker` through `WorktreeManager.ensure` (per-todo or per-lane worktree);
  add an explicit upstream-artifact contract so a dependent todo's worktree is seeded with (or can fetch)
  the committed STEP of its `dependsOn` todos; add `.gitattributes` (or LFS) handling so large binary STEP/
  PNG don't bloat every lane.
- **Side.** collab-side. **NEW / DOGFOOD #5.**

### 8. No review-stage hook: vibe-review is hard-coded text bug/completeness agents — no geometry/vision-judge stage (CONFIRMS #7b is net-new)
- **Why it matters.** A post-build fitness/vision-judge review (#7b) has nowhere to plug in. `vibe-review`
  spawns two fixed reviewer agents over text changes; there is no pluggable "review stage" the project can
  contribute a CAD/vision judge to.
- **Evidence.** `skills/vibe-review/SKILL.md`: the flow is fixed — a "bug review" agent (L77 "introduced
  bugs only") and a "completeness review" agent (L158), both prompt-templated over implementation **text**
  changes, writing to `Implementing/Go/Review/bugs|completeness`. No stage registry, no per-project review
  injection, no image/screenshot/geometry input. The CAD render infra exists in bsync (`capture_view` /
  `capture_window` / `export_*` verbs) but nothing in the review flow consumes a rendered PNG.
- **Shape of fix.** Add a manifest-declared `reviewStages[]` the vibe-review harness fans out alongside its
  built-ins; a CAD project contributes a vision-judge stage that takes the committed render PNG + the
  fitness metrics (item #3) and scores against the contract.
- **Side.** collab-side (hook) + bsync-side (the judge + render). **Relates to:** #7b (NEW infra).

### 9. Design→contract front bookend (#7a): design-exploration emits a doc, not a machine-readable contract the gate can consume (NEW / #7a)
- **Why it matters.** The plan wants the **contract as a shared artifact** between Planner and gate. Today
  the design stage's output is human prose handed off by a human pick — it never becomes the typed
  envelope/metric thresholds the gate (item #1/#3) reads.
- **Evidence.** `skills/design-exploration/SKILL.md`: Synthesize "saves it as a session **document**"
  (L22), then "on their pick hand it to the **planner** skill to decompose" (L24) — a doc + a human, no
  structured contract. The worker CAD gate already *references* "the **declared envelope** in the todo
  spec" (SKILL.md Step 3b L47) and "exactly the DOF the spec declares" (L48) — but there is no schema or
  store for those declared values; they live as English in `description`.
- **Shape of fix.** Define a typed contract object (envelope bbox, expected DOF, metric thresholds keyed to
  bsync's vocabulary) produced by design/planner, stored on the todo/blueprint, and read by BOTH the worker
  gate and the coordinator gate — closing the loop design→contract→gate.
- **Side.** manifest-seam + collab-side. **NEW / #7a.**

---

## P2 — Session-model impedance + observability

### 10. bsync↔collab session-model mismatch is structural, not just the dead-port bug (NEW)
- **Why it matters.** bsync sessions are a **flat, in-memory, project-less, idle-GC'd** namespace keyed by
  a bare `session_id` (default `"default"`); collab sessions are **project+name, persisted on disk**. There
  is no mapping between a collab `(project, session)` and a bsync `session_id`, so two collab CAD lanes
  silently share bsync `"default"` and stomp each other; and a bsync session can be garbage-collected out
  from under a still-live collab worker.
- **Evidence.** bsync: `bsync_ws_server.py` `_get_or_create(session_id="default")` (L255), `self._sessions:
  dict` in-memory (L225), `_gc_idle_sessions()` (L294) evicts idle sessions; `dispatcher.py` L355 falls back
  to literal `"default"`. There is **no project field** anywhere in the session model. The viewer port bug
  is real and separate: `viewer/static_server.py` default `port=8766` (L21) vs the live WS server
  `uvicorn.run(... port=8765)` (`viewer/server.py` L71) — a pinned-to-dead-port (8766 vs 8765) class of
  mismatch. collab: `session-registry.ts` keys off a global `sessions.json` (`REGISTRY_PATH`, L17),
  reinforcing that the two systems have **disjoint** session identity.
- **Shape of fix.** Manifest declares how a collab `(project,session)` maps to a bsync `session_id`
  (e.g. derive `session_id = "<project-slug>:<session>"`); collab passes it on every CAD verb; pin the
  viewer port from one source; suppress bsync idle-GC for sessions collab owns. (The "gripper imported as
  3 instances" symptom is downstream of this — without a stable per-lane session, multi-call part imports
  fragment.)
- **Side.** both sides + manifest-seam. **NEW.**

### 11. DOGFOOD #1 enumeration: registry is a single global `sessions.json`, not on-disk per-project `.collab/` (CONFIRMS plan #4)
- **Why it matters.** Plan point #4 wants sessions/projects derived from on-disk `.collab/`. Confirmed the
  current source of truth is a global file, which is why a project's real on-disk sessions
  (`.collab/sessions/<name>/`) can be invisible.
- **Evidence.** `session-registry.ts` `REGISTRY_PATH = join(DATA_DIR, 'sessions.json')` (L17); `load()`
  reads that one file (L115–121) with `.bak` recovery — it never enumerates `<project>/.collab/sessions/`.
  Yet real session state IS on disk (e.g. `.collab/sessions/supervisor-firstclass/{metadata.json,
  documents/,diagrams/}`). The two can diverge.
- **Shape of fix.** Make `list_sessions`/`list_projects` enumerate on-disk `.collab/` dirs as the source of
  truth (or reconcile registry against disk on read).
- **Side.** collab-side. **Relates to:** plan #4 / DOGFOOD #1 (this is the concrete evidence).

### 12. Multi-project supervisor / observability seam for CAD (NEW, smaller)
- **Why it matters.** For bsync to be a first-class peer, its work must be visible in the supervisor like a
  web project. The audit trail and watch-registration are generic and should already carry CAD lanes — good
  — but there is no per-project artifact-type awareness (a STEP/render is just a file), and the
  layer-attribution (collab vs bsync) needed to triage CAD failures has no store (see item #5).
- **Evidence.** `coordinator-live.ts` wraps every lifecycle op in `recordSupervisorAudit({kind,…})`
  (claim/complete/spawn/escalate, L100/112/189/246) and auto-`addSupervised`/`addWatchedProject` (L185) —
  generic and project-agnostic (good). But the only failure-attribution signal is the worker's free-text
  completion message (SKILL.md L55 "name the verb that failed … until structured friction-notes exist") —
  explicitly acknowledging the structured store doesn't exist yet (item #5).
- **Shape of fix.** Surface attempt/friction layer-attribution (item #5) in the supervisor view so CAD
  failures are triaged as collab-layer vs bsync-layer without reading transcripts.
- **Side.** collab-side. **NEW.**

---

## Things that COMPLICATE / refine the 4-point plan
- **#2 is a *new build*, not a hardening.** There is no coordinator gate today; the gate is 100% worker
  prose + a trusted string arg (item #1). The plan's "the worker cannot self-certify" requires moving
  verdict authority that currently lives *entirely* in the worker.
- **#3 is ~half-done but stranded.** The metric vocabulary AND a deterministic `fitness_verdict` gate are
  already written in `fitness.py` — but unreachable (no MCP verb). The work is *exposure*, not *design*
  (item #3).
- **#1's seam doesn't exist yet** — zero manifest/contextPrompt references; `AgentProfile` has no
  `contextPrompt` field (item #2). And the same seam is the only fix for the CAD permission-stall class
  (item #6) — they should be built together.
- **Plan is silent on binaries.** Both the gate (text/tsc/tests) and the review surface (raw `git diff`
  patch) assume text; CAD's binary STEP/PNG are first-class deliverables with no diff/review/round-trip
  path (item #4). This crosscuts #2.
- **Worktree isolation (#5) underlies #2's "committed artifact."** The coordinator gate is supposed to run
  on "the committed artifact," but the launch path doesn't use worktrees at all and runs in a shared tree
  (item #7) — so "the committed artifact" isn't cleanly defined per-todo yet.
