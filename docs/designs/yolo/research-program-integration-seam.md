# collab Program-Integration Seam (SEAM·collab)

How collab plugs a second program (bsync/build123d CAD) into its Planner/Coordinator/worker
orchestration, and what a third program (yolox-markup) must contribute. All cites are file:line.

## TL;DR — the integration seam is DATA, not code

collab learns **zero domain specifics**. A program plugs in by shipping a declarative manifest in
its own repo (`<project>/.collab/project.json`) plus a deterministic gate command. collab's core
treats every program identically; the program supplies the domain knowledge as data.

The seam has four orthogonal axes:
1. **Cross-project routing** — `targetProject` on a todo (tracking repo ≠ implementation repo).
2. **Acceptance gate** — manifest `gateCommand` run in the target repo; authoritative verdict.
3. **Agent profiles** — `type` → profile, overridable per-project via the manifest.
4. **Artifacts** — text change-sets today; binary deliverables (STEP/PNG) are a known gap.

---

## 1. THE bsync/CAD SEAM — cross-project (`targetProject`)

### The manifest (the whole seam in one file)
`src/config/project-manifest.ts:1-66` documents `<project>/.collab/project.json`:
- `profiles` — type → `{ allowedTools, contextPrompt, model, runtimeMode, pathRules }`
  (`:39-66`). A project ships its own `cad` profile here.
- `gateCommand` — the mechanical acceptance gate command for that repo, e.g.
  `python3.10 -m pytest bsync-tools/tests -q` (`:25`, `:59-62`).
- `metricRefs` — metric-vocabulary entries the gate references (`:26`, `:63-65`).
- `loadProjectManifest` (`:73-90`) caches it; a malformed/absent manifest returns null and the
  hard-coded defaults stand — bad manifest NEVER breaks core (`:29-30`).
- `inferTypeFromManifest` (`:103-124`) — project-declared `pathRules` (regex source strings) infer
  a profile `type` from touched files (e.g. `.step`/`.parts` → `cad`), first-match-wins.

### `targetProject` on a todo
`src/services/todo-store.ts:44-45` — `targetProject: string | null`. "...acceptance gate against
THIS repo's change-set + manifest gate command." Persisted column at `:148`, `:179`, round-tripped
at `:242`, `:299`, `:330`, `:345`. Settable via CreateTodoInput (`:76`) and update patches.
The MCP `add_session_todo`/update tools expose it (`src/mcp/tools/session-todos.ts`).

### How a worker acts on a DIFFERENT project than the one planning it
`src/services/coordinator-live.ts launchWorker` (`:232-322`):
- `const targetProject = todo.targetProject ?? project` (`:270`). The todo LIVES in `project` (the
  tracking store where it was claimed) but is IMPLEMENTED in `targetProject`.
- Worker profile resolved from the **target** repo's manifest (`:271`).
- Worker spawned with `cwd = targetProject` so edits land there (`:264-270`, `launchCwd`/`ensureSession` `:310`).
- A cross-project context note is appended (`:277-284`): "make code edits in your cwd
  (`targetProject`); but for collab todo ops — get_todo/complete_todo/friction note — use
  `project=<tracking project>`." This split (edits→target, bookkeeping→tracking) is the crux.
- Cross-project gate bug fix: the gate must run in the TARGET repo or it is blind to the edits
  (the observed f719e7e0 bug) — `:469-474`.
- Test: `src/services/__tests__/coordinator-gate-crossproject.test.ts`.

---

## 2. THE ACCEPTANCE GATE

### Two-layer gate: worker self-check + authoritative coordinator gate
**Worker layer (advisory, scoped):** `skills/worker/SKILL.md` Step 3 (`:27-41`). The worker runs a
gate scoped ONLY to its own change-set (`git diff --name-only`), because the pool shares one working
tree with sibling lanes' uncommitted edits. Code gate = `npx tsc --noEmit` + scoped tests, using the
**project's own interpreter/runner** (detect venv/pyproject, not ambient python). Never run the full
suite (false rejects from sibling lanes). Worker reports `accepted | rejected` via `complete_todo`.

**Coordinator layer (AUTHORITATIVE):** `src/services/coordinator-live.ts runGate` (`:464-490`). Runs
the manifest `gateCommand` in the target repo — a verdict the worker cannot fake. No `gateCommand`
→ returns null → honor the worker's self-report (backward compatible). Fails CLOSED: an un-runnable
gate blocks acceptance (`:487-488`). Structured verdicts: a gate may emit a trailing JSON line
`{passed, reasons, metrics}` parsed by `parseTrailingVerdict` (`:480-483`, `:494-514`) — this is how
a domain (CAD fitness) gate returns rich results.

### How a todo gets "accepted"
`acceptanceStatus: 'pending'|'accepted'|'rejected'|null` on the todo (`todo-store.ts:46`).
`completeTodo` (`:530-590`): a `rejected` completion is NOT done — it goes to `status='blocked'`
(SI-3, `:538-551`); `accepted` → `status='done'`; dependency satisfaction explicitly excludes
rejected (`depSatisfied` `:518-520`, `:563`, `:581`). On acceptance with worker-isolation, the
worker's worktree branch is committed + merged into the integration branch (`:194-222`).

### Binary deliverables (STEP/PNG) differ — KNOWN GAP
- CAD/geometry gate (`skills/worker/SKILL.md` Step 3b, `:42-55`): for `type:cad` todos `tsc`/vitest
  say nothing — "a script that runs is not a part that exists." Uses bsync MCP verbs:
  `validate_geometry` (non-empty/valid solid, volume>0), envelope/bbox sanity, `analyze_dof`
  (kinematics), `check_clearance` (interference), STEP round-trip export. Solver/tool limitations →
  **escalate** (not reject); a bad change → reject. Attribution (collab-layer vs bsync-layer) recorded
  in a friction note (`:59-85`).
- Work-graph todo **"Binary artifact (STEP/PNG) gate + review path"** (`49352848`):
  `docs/roadmap.md:43` — "Text-diff gate can't see CAD deliverables." Status ready, pri 1,
  dep `28d016aa`. Sibling: **"Deterministic CAD gate-runner"** (`cfde885f`, `roadmap.md:41`) —
  "Authoritative verdict, not agent self-report" — this is exactly the `runGate` authoritative layer.
- Design doc: `docs/designs/cad-dogfood/EXPERIMENT.md` — Q1 (`:42-45`) is precisely "where does the
  worker mechanical gate break for a non-code artifact?"; the success oracle (`:74-85`) enumerates
  DOF/bolted/clearance/validity/STEP-export checks; prep item P1 "CAD acceptance gate" (`:111`).

---

## 3. AGENT PROFILES / TYPES — routing a todo to the right worker

### type → profile mapping
`src/config/agent-profiles.ts`:
- `AgentProfileType = 'default'|'frontend'|'backend'|'api'|'ui'|'library'` (`:32`).
- `AGENT_PROFILES` registry (`:46-53`) — small by design; vary permissions via `runtimeMode`, not
  bespoke tool strings.
- `resolveProfile(type, project)` (`:65-79`) — base global profile MERGED OVER by the project
  manifest's profile for that type (manifest fields win; omitted keep global). This is how
  build123d's `cad` profile plugs in without collab knowing it exists (`:57-64`).
- `inferProfileType(files)` (`:94-104`) + `PATH_RULES` (`:86-92`) — file-based inference,
  multi-domain/unmatched → `default`.

### Where the type is assigned & where launch consumes it
- Assigned at **sync time**: `src/mcp/workflow/task-sync.ts:386-403`, `:452` — backfills each linked
  todo's `type` = `inferTypeFromManifest(project, files) ?? inferProfileType(files)` (manifest rules
  beat global; idempotent; never overrides an explicit assignment).
- Consumed at **launch**: `coordinator-live.ts resolveWorkerProfile` (`:129-132`) → `resolveProfile`
  + `invokeSkill = /mermaid-collab:worker <id>`; pool routing `todoTypeToPoolType` (`:241`).

### Planned: composable taxonomy
`docs/roadmap.md:48` "cad/ocp agent profile carrying bsync context" (`1eb8095d`, planned) — cold-start
context + tool allowlist; cad-dogfood prep item P3 (`EXPERIMENT.md:115`). The "capability × tech-packs
× project-context" taxonomy generalizes the current flat registry (the manifest already proves the
project-context axis).

---

## 4. WHAT A PROGRAM CONTRIBUTES — checklist for yolox-markup

To plug a new program in, ship these (most are DATA in the new program's repo):

1. **Registered project** — absolute path registered via the project registry
   (`src/services/project-registry.ts:66` `register(path)`; must be absolute + exist). The new
   program's repo root becomes a valid `targetProject`.
2. **`<repo>/.collab/project.json` manifest** (`project-manifest.ts`) declaring:
   - `profiles` with a domain `type` (e.g. `markup` / `ml`) — `allowedTools` (the program's MCP
     verbs/CLI), `contextPrompt` (warm-start domain knowledge), `model`, `runtimeMode`.
   - `pathRules` so its file shapes (e.g. `.coco.json`, `datasets/`, `*.pt` weights) route to that
     type via `inferTypeFromManifest`.
   - `gateCommand` — the deterministic acceptance gate (e.g. `python -m pytest annot-tests -q`, or a
     metric script). Should emit a trailing `{passed, reasons, metrics}` JSON line for a structured
     verdict.
   - `metricRefs` — its fitness/metric vocabulary (mAP, IoU, label-coverage, etc.).
3. **A domain gate-runner** — the script `gateCommand` invokes, run in the program's repo with its
   own interpreter. For binary/non-text deliverables (annotated images, trained weights), it must
   validate the ARTIFACT, not just exit 0 — the same gap the CAD geometry gate fills. Pending the
   "Binary artifact gate + review path" todo for first-class binary handling.
4. **Artifact handling** — text change-sets work today via git diff. ML/annotation binary outputs
   (images, weights, COCO/JSON datasets) need the binary-artifact gate/review path (`roadmap.md:43`)
   and likely `set_artifact_metadata` / a viewer, analogous to the bsync STEP viewer.
5. **MCP tools (optional but typical)** — the program exposes domain verbs (bsync did:
   `validate_geometry`, `analyze_dof`, `check_clearance`, `step_save`). yolox-markup would expose
   annotation/training/eval verbs; list them in the profile's `allowedTools` so the warm worker can
   call them. The worker skill's domain-gate section (`worker/SKILL.md:42-55`) is the template — a
   parallel "ML/annotation gate" sub-step (validate dataset non-empty, metric thresholds, eval
   reproducibility) mirrors the CAD geometry gate.
6. **Todos targeting it** — planner/sync set `targetProject = <new repo>` on todos; everything else
   (claim, lease, escalation, isolation, supervisor audit) stays in the tracking project unchanged.

Nothing in collab core changes — the program is additive data + one gate script + (optionally) an MCP server.

---

## 5. RELEVANT DESIGN DOCS (docs/designs/)

- **`docs/designs/cad-dogfood/EXPERIMENT.md`** — THE seam design doc. Acceptance-gate abstraction for
  non-code artifacts (Q1), session isolation (Q2), profiles-carry-context+gate, success oracle, and
  the P0–P5 prep items that map directly to the SEAM work-graph todos. Most relevant for program
  integration.
- **`docs/roadmap.md:36-49`** — EPIC "CAD dogfood & bsync seam" (`d61c73de`): the live work-graph
  for the seam — deterministic CAD gate-runner, stable per-session bsync id, binary STEP/PNG gate,
  DfM analyzers, cad/ocp profile, machine-checkable interface contract. The integration-point backlog.
- **`docs/designs/code-artifact/design.md`** + `snippet-enhancement/code-artifact-design.md`,
  `bp-code-artifact.md` — code/binary artifact storage model; relevant to binary deliverable handling.
- Other design dirs (e2e-test, snippet-enhancement, storybook-blend, fair-light-stream, etc.) are
  feature-specific and not part of the program-integration seam.

### Source files (the seam in code)
- `src/config/project-manifest.ts` — the declarative adapter (manifest schema + loader + inference).
- `src/config/agent-profiles.ts` — type→profile registry + manifest merge + path inference.
- `src/services/todo-store.ts` — `targetProject` + `acceptanceStatus` persistence + completion semantics.
- `src/services/coordinator-live.ts` — cross-project launch (`launchWorker`), authoritative
  `runGate`, structured-verdict parsing, worker isolation merge-back.
- `src/mcp/workflow/task-sync.ts` — assigns each todo its profile `type` at sync time.
- `src/services/project-registry.ts` — project registration.
- `skills/worker/SKILL.md` — worker gate (code Step 3 + CAD/geometry Step 3b + friction attribution).
- Tests: `coordinator-gate-crossproject.test.ts`, `agent-profiles.test.ts`, `project-manifest.test.ts`.
