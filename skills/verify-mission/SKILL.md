---
name: verify-mission
description: Run the INDEPENDENT VERIFY gate for a convergence mission — dispatch a separate reviewer agent per acceptance criterion to check it against ground truth (maker≠checker), record each verdict + evidence, then let the mission converge/stop/loop off independently-checked results.
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - mcp__plugin_mermaid-collab_mermaid__get_mission
  - mcp__plugin_mermaid-collab_mermaid__set_mission_criterion
---

# verify-mission — the independent gate

This is the **heart of the convergence loop**. Per the loops principle: *the model that did the work is far too generous a grader.* The verify gate must be an **independent check** — a fresh reviewer, separate from whoever did the work — that can actually FAIL the work. Without it you have "the agent agreeing with itself on repeat" (the Ralph-Wiggum loop).

Invoke this **when the mission's derived `status` is `needs-verify`** (a serving epic has landed but a criterion is still unverified, `verifiedAt == null`), or any time a criterion needs re-checking. This is not a phase the loop steps into; it is a gate that fires when a criterion goes unverified.

## Inputs
- `project` — the mission's tracking project (abs path).
- `todoId` — the `[MISSION]` node id. (If not given, ask, or use `get_mission` on the mission you're driving.)

## Protocol

### 1. Read the criteria
Call `get_mission { project, todoId }`. Take its `criteria[]` — each is `{ id, text, met, evidence }`. These are the acceptance gate. Also note the mission's `description` (the goal) and `procedure` for context.

### 2. Dispatch ONE independent reviewer agent per criterion
For EACH criterion (verify all of them fresh each VERIFY — don't trust a stale `met`), spawn a **separate** `Agent` (the Task tool). **Do NOT verify them yourself** — you may have been party to the work; independence is the whole point. Run the per-criterion agents in parallel (one message, multiple Agent calls).

Each agent's prompt:
```
You are an INDEPENDENT verifier for a convergence mission. You did NOT do this
work — your job is to RULE, skeptically, whether ONE acceptance criterion is
genuinely met against GROUND TRUTH, and cite evidence. Default to NOT MET when
unsure — a false "met" is the costly error (it makes the loop declare victory on
unfinished work).

Project: {project}
Mission goal: {mission description}
CRITERION TO CHECK: "{criterion.text}"

Check it against real ground truth — read the relevant code, run the tests / type
checker / build, drive the running app, inspect output. Do NOT rely on anyone's
claim that it works; confirm it yourself.

Tool preferences: Read/Grep/Glob for code; Bash only for genuinely needed commands
(tests, build, curl). Prefer the project's real test/build commands.

Return EXACTLY a JSON object on the last line:
{"met": true|false, "evidence": "<one or two sentences citing what you actually
observed — a test that passed, a file/symbol present, a UI behavior seen — or the
concrete gap that makes it NOT met>"}
```

### 3. Record each verdict (with evidence, sha, and paths)
For each returned verdict, call:
`set_mission_criterion { project, criterionId, met, evidence, verifiedBy: "<reviewer agent label>", verifiedAtSha: "<git sha>", evidencePaths: ["file/path1", "file/path2", ...] }`.

The `evidence` + `verifiedBy` are the durable audit trail of WHY the gate passed/failed. **`verifiedAtSha`** is the git commit hash the verdict was checked against — it is the staleness pin. If a later `land_epic` touches a file in **`evidencePaths`**, the mission system automatically re-opens the criterion (it is no longer staleness-pinned). This ensures criteria stay fresh as the codebase evolves.

How to supply these fields:
- **`verifiedAtSha`**: the git commit hash at the time the verdict was checked. Either have each per-criterion agent return it, or capture the current sha via `git rev-parse HEAD` (Bash) at the start of step 2 and use it for all verdicts in this gate run.
- **`evidencePaths`**: the file paths the verdict cited as evidence. Have each agent return them (e.g., "the test file `tests/auth.test.ts` passed," or "the UI component `src/components/Login.tsx` renders correctly"). Include only files that directly support the verdict — if the criterion is broad, list the key files checked.

**Fail closed**: if an agent couldn't confirm a criterion, record `met: false`.

### 4. Let the mission decide
After all verdicts are recorded, the gate has run. The mission's **derived `status` recomputes on the next `get_mission` call** (via `deriveMissionStatus`, see `mission-store.ts:564-573`):
- **All criteria met** → `status = converged` (goal genuinely achieved).
- **Unmet criteria remain** → conductor re-enters `needs-discovery` (iteration++); the unmet criteria and their evidence ARE the next iteration's input. If the mission's budget is exhausted, `status = over-budget` or `abandoned` instead (terminal states).

The gate does **not** advance a phase or step a counter. Convergence is a property of the criteria themselves, read back via the derived `status` on the next conductor nudge. Record verdicts, and the loop's next step emerges from the data.

### 5. Report
Summarize: N/total criteria met, which failed + the evidence, and the resulting phase (converged / stopped / looped to discover). If it looped, the un-met criteria + their evidence ARE the next iteration's DISCOVER input.

## Rules
- **Independence is non-negotiable.** A fresh agent per criterion, none of them "you." Reusing the maker defeats the gate.
- **Fail closed.** Uncertain = not met. Never grade generously to let the loop finish.
- **Evidence is mandatory.** A verdict with no cited ground truth is not a verdict.
- **Re-verify every criterion each pass** — a criterion met last iteration can regress.
