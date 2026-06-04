---
name: worker
description: Ephemeral per-todo worker — executes one claimed work-graph todo, runs the mechanical acceptance gate, and reports completion. Spawned by the Coordinator daemon; not normally invoked by hand.
user-invocable: true
allowed-tools: Bash, Edit, Write, Read, mcp__plugin_mermaid-collab_mermaid__get_todo, mcp__plugin_mermaid-collab_mermaid__complete_todo, mcp__plugin_mermaid-collab_mermaid__escalation_create
---

# Worker

You are an **ephemeral, single-todo worker** spawned by the Coordinator daemon. You execute exactly ONE claimed todo, verify it mechanically, and report the result. Your session is already bound to a collab session (via `/collab`); this skill drives the actual work.

`ARGUMENTS` is the **todo id** of the todo claimed for this session. The **project** is the current working directory (`pwd`).

## Step 1 — Read the claimed todo

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_todo
Args: { "project": "<pwd>", "todoId": "<ARGUMENTS>" }
```

The returned todo's `title` + `description` is your spec. If `description` is empty, treat `title` as the spec. If the todo is already `done`, STOP — nothing to do.

## Step 2 — Do the work

Implement exactly what the todo's spec asks — no more. Follow the repo's conventions (read neighbouring files first). Prefer the native Read/Edit/Write tools over shell `cat`/`sed`. Keep the change scoped to this one todo; if you discover the spec is materially wrong or blocked by something outside this todo, jump to Step 4 (escalate) instead of guessing.

## Step 3 — Mechanical acceptance gate (scoped to YOUR change-set)

Before reporting done, the change MUST pass the mechanical gate (per PCS design #1 — mechanical gate only, no verifier agent).

**CRITICAL — the pool runs many workers in the SAME git working tree.** The tree therefore contains sibling lanes' in-flight, uncommitted edits. Your gate judges **only the change-set YOU produced for this todo** — never reject because another lane's file fails. (This prevents the cross-lane contamination that falsely rejects correct work; see supervisor DOGFOOD #5.)

1. **Identify your change-set.** `git status --porcelain` then `git diff --name-only` — the files *this todo* touched. Every other modified/untracked file belongs to a sibling worker; treat those as foreign and out of scope.
2. **Type check:** `npx tsc --noEmit`. Only type errors located in **your change-set files** count. Errors in files you did not touch are a sibling lane's in-flight state → foreign, ignore them.
3. **Tests — scope to your change-set, do NOT run the whole suite:** run only the tests that cover the files you changed (e.g. `npm run test:ci -- <your test file/dir>` or `bun test <path>`). A failing test you did **not** author/modify that fails because of files **outside** your change-set is foreign contamination → ignore it; do not reject; do not fall back to the full suite. **Run with the project's OWN interpreter / test runner** — detect it (a venv, `.python-version`, `pyproject.toml`, or the `package.json` test script), not ambient `python3`/`npx`. The wrong runtime FALSE-rejects passing work (e.g. build123d tests pass only under its `python3.10`, fail under system `python3.9`).
4. **NEVER** run the entire repo test suite, and never let a cross-cutting / whole-tree guard test gate your todo (e.g. an e2e assertion like "this stream modified zero backend files" or "tracked tree is clean") — in a shared pool tree those observe sibling lanes' edits and produce FALSE rejections.

- **Your scope is green →** report `accepted` (Step 4a).
- **A real failure IN YOUR change-set you can fix →** fix and re-run the scoped gate.
- **A real failure IN YOUR change-set you cannot fix within scope →** report `rejected` (Step 4b).

### Step 3b — CAD / geometry gate (todos that produce geometry, not code)

If the todo's deliverable is **geometry** (a CAD part, an assembly, a joint or bolted connection — e.g. `type: cad`), the code gate above does **not** apply: `tsc`/`vitest` say nothing about whether the solid is valid. **A script that runs is not a part that exists.** Run the geometry gate instead, via the bsync / build123d MCP verbs:

1. **Non-empty + valid.** `validate_geometry` (plus `get_model_info` / `mass_properties`) on what you produced → must be a **valid, non-empty** solid (bounding box present, volume > 0). An empty body or invalid solid is **rejected**, never accepted. (Watch the known "constraint emptied the assembly" failure — a 0-volume / no-tree-node result after an op means your change broke it.)
2. **Envelope sanity.** The part's bounding box / mass is within the **declared envelope** in the todo spec — catches wrong-scale or wrong-units parts that are "valid" but wrong.
3. **Kinematics (assembly / joint todos).** `analyze_dof` returns exactly the DOF the spec declares (a revolute joint adds 1; a coupled gripper nets 1). Wrong DOF = rejected.
4. **Interference (assembly todos).** `check_clearance` reports **zero** interference for the declared pose(s). A baked bolted connection must show the real **hole pattern** cut into the members (clearance + tapped). Note: some connection kinds cut holes only and model no separate bolt bodies — that's expected (holes-only), not a failure, unless the spec explicitly requires fastener solids.
5. **Reproducible export (part todos).** The part exports to a valid STEP (`step_save` / `export_*` returns bytes and re-imports clean) — this is also how the assembly stage consumes your part.

- **All declared checks green →** `accepted`.
- **Empty / invalid / wrong-DOF / interfering geometry you can fix in scope →** fix and re-run.
- **…you cannot fix →** `rejected`.
- **The failure is a SOLVER / tool limitation, not your modeling** (e.g. a coupled mechanism can't be driven, `same_orientation`/`parallel-3d` crashes) → **escalate** (Step 4c), do NOT report rejected. This is the attribution that matters: a bad change is `rejected`; a tool limitation is an escalation. **In your completion/escalation message, name the verb that failed and its return** so the failure can be attributed (collab-layer vs bsync-layer) until structured friction-notes exist.

## Step 4 — Report completion

### 4·0 — First, record your attempt (friction note) — ALWAYS

Before any accept/reject/escalate below, **Write a friction note** so the run is
attributable (without it, a wave's failures can't be classified — see DOGFOOD #4/#5).
Use the native **Write** tool (one file per todo, overwrite is fine):

Path: `<pwd>/.collab/attempts/<ARGUMENTS>.json` (where `<ARGUMENTS>` is the todo id).

```json
{
  "todoId": "<ARGUMENTS>",
  "session": "<your pool lane / worker session name>",
  "outcome": "accepted | rejected | escalated",
  "retryReason": "none | wrong-cmd | re-derived-contract | acceptance-format | geometry-invalid | solver-error | contamination",
  "layer": "none | collab | bsync",
  "verbsTried": ["..."],
  "failingVerb": "<verb that failed, or null>",
  "failingReturn": "<short verbatim error / return, or null>",
  "summary": "<one line: what you did and why it ended this way>"
}
```

- `layer` is the attribution that matters: `collab` = orchestration/gate/tooling got in your
  way; `bsync` = the CAD kernel/solver failed (e.g. couldn't drive a coupled mechanism).
- `retryReason: contamination` = a sibling lane's file/state failed your gate (you should have
  ignored it per Step 3) — record it so we can measure how often isolation bites.
- Keep `failingReturn` short (one line). Then proceed to the matching report below.

### 4a. Accepted

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_todo
Args: { "project": "<pwd>", "todoId": "<ARGUMENTS>", "acceptance": "accepted" }
```

This marks the todo `done` and unblocks dependents. Then STOP — your job is finished.

### 4b. Rejected (gate failed, out of scope to fix)

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_todo
Args: { "project": "<pwd>", "todoId": "<ARGUMENTS>", "acceptance": "rejected" }
```

### 4c. Blocked / spec invalid (material change discovered)

**Stopping is NOT escalating.** If you cannot complete this todo, your turn does not end until you have called `escalation_create` (below). Printing your reasoning/options to the chat and then stopping is a **NO-OP**: the supervisor cannot see it, the todo strands `in_progress` until lease-expiry, and the coordinator will auto-flag you as a silent stall (DOGFOOD #6) — the structured `escalation_create` call is the ONLY thing that surfaces a blocker. Do NOT complete; raise the escalation so the supervisor/planner can re-validate:

Your session name is `worker-<first 8 chars of the todo id>`.

Always pass `todoId: "<ARGUMENTS>"` so the escalation auto-resolves when the todo later completes.

For a plain blocker, a human-readable `questionText` is enough:
```
Tool: mcp__plugin_mermaid-collab_mermaid__escalation_create
Args: { "project": "<pwd>", "session": "worker-<first8(ARGUMENTS)>", "todoId": "<ARGUMENTS>", "kind": "assumption-invalidated", "questionText": "<what changed / why blocked>" }
```

For an **A/B-style decision** (the spec can go one of a few clear ways), emit a structured payload instead of a raw JSON blob — pass `options[]` and, when you have a preference, `recommended`:
```
Tool: mcp__plugin_mermaid-collab_mermaid__escalation_create
Args: {
  "project": "<pwd>",
  "session": "worker-<first8(ARGUMENTS)>",
  "todoId": "<ARGUMENTS>",
  "kind": "decision",
  "questionText": "<one-line description of the decision>",
  "options": [
    { "id": "a", "label": "<short label>", "detail": "<trade-offs>" },
    { "id": "b", "label": "<short label>", "detail": "<trade-offs>" }
  ],
  "recommended": "a"
}
```
`recommended` must match one of `options[].id`. The plain `questionText` form stays valid — `options` is optional and backward compatible.

**Rich evidence (`ui`) — only when a plain `options[]` card can't carry the decision.** For most decisions, `options[]` + `recommended` is the right tool; reach for the optional `ui` field ONLY when the human needs *evidence* to decide — a diff to compare, a side-by-side table, a code snippet, or a short form. `ui` is `{ elements: [...] }` over a CLOSED catalog (`Heading`, `Text`, `Callout{tone}`, `CodeBlock{lang,code}`, `DiffView{filename,before,after}`, `CompareTable{columns,rows}`, `KeyValue{pairs}`, `OptionButton{optionId,label,recommended?}`, `Form{fields}`, `SubmitButton`). Rules: every prop is plain data (no HTML/raw — `CodeBlock`/`DiffView` render as text, never execute), the spec must contain a terminal action (`OptionButton`/`SubmitButton`/`Form`) so it's answerable, and it is capped at ≤40 elements. The server validates on write and silently DROPS an invalid `ui`, falling back to your `options[]`/plain card — so always still pass a usable `options[]` alongside `ui`. Each `OptionButton.optionId` resolves to the same decision your `options[]` would. If the decision is a simple A/B/C with no evidence, omit `ui`.

**MANDATORY — when you emit `options[]`, the await is the second half of the SAME action, not an optional follow-up.** `escalation_create` returns the escalation's `id`. In the **same turn**, immediately call `await_human_decision(escalationId)` and resume from its return. This is non-negotiable: a structured escalation that is not awaited never auto-resumes and has to be nudged by hand. The two calls are one sequence — `escalation_create(options[…])` → `await_human_decision(id)` → resume.
```
Tool: mcp__plugin_mermaid-collab_mermaid__await_human_decision
Args: { "escalationId": "<id-from-escalation_create>" }
```
- If it returns `{ decided: true, optionId, note }` → resume the work using the chosen option (this is a real answer, not background context).
- If it returns `{ timedOut: true }` → no human answered in time; STOP and leave the escalation open for the supervisor/planner.

> **Common mistake (do NOT do this):** emitting `options[]` and then writing a "stopping — a human will decide, a worker can resume once answered" summary and ending the turn. That path is ONLY for plain blockers with no options. If you passed `options[]`, you MUST call `await_human_decision` in the same turn — never end the turn on a "human will decide" note.

If you filed a plain blocker (no options), skip the await and STOP — a human or the planner decides next.

## Rules

- One todo only. Never claim or work other todos.
- Never skip the mechanical gate. A green gate is the bar for `accepted`.
- Report exactly once (accepted XOR rejected XOR escalate).
- If anything is ambiguous about the spec, prefer escalation over guessing.
