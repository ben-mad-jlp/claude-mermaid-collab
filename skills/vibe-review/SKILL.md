---
name: vibe-review
description: Run parallel bug and completeness review after vibe-go execution
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Vibe Review

Run a parallel bug review and completeness review after `/vibe-go` completes.
Two agents run simultaneously — one checks for bugs, one checks for completeness.

## Step 1 — Gather context

**Get the blueprint:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
```
Find the blueprint document (name contains `blueprint`, `blueprint: true`).
```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "<blueprint-id>" }
```

**Get the git range:**
```bash
# Find the base commit before implementation started
BASE_SHA=$(git log --oneline | grep -m1 "blueprint\|pre-implementation\|skeleton" | awk '{print $1}')

# Fallback: merge-base against main/master
if [ -z "$BASE_SHA" ]; then
  BASE_SHA=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || git rev-parse HEAD~20)
fi

HEAD_SHA=$(git rev-parse HEAD)
echo "Base: $BASE_SHA"
echo "Head: $HEAD_SHA"
git diff --stat $BASE_SHA..$HEAD_SHA
```

**Get implementation summary docs:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
```
Find all `Implementing/Wave *` documents and read them.

**Announce:**
```
Running review — launching bug check and completeness check in parallel.
```

## Step 2 — Spawn both agents in parallel

Launch these two agents simultaneously in the same message:

---

### Bug Review Agent

```
Project: {project}
Session: {session}

Git range: {BASE_SHA}..{HEAD_SHA}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep
- Find files: use the Glob tool — never find

You are reviewing implementation changes for introduced bugs only.
Do NOT check design compliance — only correctness.

Run: git diff {BASE_SHA}..{HEAD_SHA}

For each changed file, check for:

**Logic bugs:** off-by-one errors, wrong comparisons, inverted boolean logic, missing returns
**Null/undefined:** unguarded property access, missing null checks, optional chaining gaps
**Error handling:** swallowed errors, missing await, unhandled promise rejections
**Async/concurrency:** race conditions, concurrent mutations
**Data integrity:** input mutation, shallow vs deep copy, type coercion
**Resource management:** unclosed handles, missing cleanup, leaked listeners/timers
**Edge cases:** empty inputs, negatives, large inputs, unicode

For each bug found, report:
- Severity: Critical / Important / Minor
- File and line number
- What's wrong and why it matters
- Specific fix

If no bugs found, say so clearly.

Save findings:
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "{project}",
  "session": "{session}",
  "name": "Implementing/Review/bugs",
  "content": "# Bug Review\n\n[findings]"
}

Return: "Bug review complete. [N bugs found / No bugs found]. Saved to Implementing/Review/bugs."
```

---

### Completeness Review Agent

```
Project: {project}
Session: {session}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep
- Find files: use the Glob tool — never find

You are checking whether the implementation matches the blueprint spec.

Blueprint content:
{full blueprint document content}

Implementation summaries:
{all impl-* document contents}

Check the following:

**Tasks:** Were all tasks from the blueprint completed?
**Files:** Do all files listed in the blueprint exist and have real implementations (not stubs)?
**Functions:** Does every function in the blueprint exist with non-stub implementation?
**Tests:** Are test files present and do they pass?
**Stubs removed:** Search for TODO, throw new Error('Not implemented'), NotImplementedError, raise NotImplementedError, todo!() in implementation files
**Acceptance criteria:** Does the implementation satisfy the goals described in the blueprint's source artifacts?

For each gap found, report:
- What was specified
- What is missing or incomplete
- File and location if applicable

If everything is complete, say so clearly.

Save findings:
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "{project}",
  "session": "{session}",
  "name": "Implementing/Review/completeness",
  "content": "# Completeness Review\n\n[findings]"
}

Return: "Completeness review done. [N gaps found / Everything complete]. Saved to Implementing/Review/completeness."
```

---

## Step 3 — Present results

After both agents return, summarize:

```
## Review Complete

### Bug Check
[Summary from bug agent — count and severity breakdown, or "no bugs found"]

### Completeness Check
[Summary from completeness agent — gaps found, or "all complete"]

### Documents
- Implementing/Review/bugs — open in collab UI for full findings
- Implementing/Review/completeness — open in collab UI for full findings
```

## Step 4 — Fix Wave

Evaluate the combined results from the bug and completeness agents:

### Case A: Critical or Important bugs found, OR completeness gaps found

Announce:
```
Fix wave — launching agents for [N] issues.
```

Collect all critical/important bugs and completeness gaps into a flat list. Assign each a slug:
- Bug slugs: `bug-{severity-lower}-{short-description}` (e.g. `bug-critical-null-check`)
- Gap slugs: `gap-{short-description}` (e.g. `gap-missing-auth-handler`)

#### 4.1 Spawn RESEARCH agents (one per issue, in parallel)

Each research agent handles ONE issue — reads only the relevant files for that issue.

```
Agent(
  model: "sonnet",
  description: "Research {issue-slug}",
  prompt: "
You are a RESEARCH agent. Read files and return a plan. Do NOT make any code edits.

Project: {project}
Session: {session}
Issue: {issue-slug}
Files: {files relevant to this bug or gap}
Description: {bug description or gap description from review agents}

THEN: Read the source files listed above. For each file, determine:
- What functions/blocks need to change
- The surrounding context (what's above/below the edit point)
- The specific code to add or modify

Use the Read tool (NEVER cat, head, tail, or ls) and Grep tool (NEVER shell grep or rg).

If the issue touches multiple files, return ONE implement step per file.

For large files (>500 lines with multiple logical change groups), split into multiple TASKS entries for the same file, each covering a single narrow change. Label them: FILE: {path} | CHANGES: {one specific change only} | CLASS: ...

After reading all files:

1. Classify each file change as: behavioral / structural / trivial
   - behavioral: changes observable runtime behavior (logic, control flow, data flow, side effects)
   - structural: refactor/rename with no behavior change
   - trivial: comments, formatting, config values

2. For each behavioral file, post a before/after diagram to the collab tree:
   Tool: mcp__mermaid__create_diagram
   Args: { \"project\": \"{project}\", \"session\": \"{session}\", \"name\": \"Implementing/Fix-Wave/{issue-slug}/{filename}\", \"content\": \"<mermaid flowchart diagram with before and after subgraphs. Style the before subgraph with fill:#ffdddd,stroke:#ffaaaa (pale red) and the after subgraph with fill:#ddffdd,stroke:#aaffaa (pale green). Example structure: flowchart TD\\n  subgraph before[\\\"Before\\\"]\\n    ...nodes...\\n  end\\n  subgraph after[\\\"After\\\"]\\n    ...nodes...\\n  end\\n  style before fill:#ffdddd,stroke:#ffaaaa\\n  style after fill:#ddffdd,stroke:#aaffaa>\" }

Return in this EXACT format (include the ISSUE_ID on every line):

STATUS: parallel
ISSUE_ID: {issue-slug}
TASKS:
- FILE: {absolute path} | CHANGES: {exactly what to edit — be specific: function name, what to add/remove/modify, the logic} | CLASS: behavioral|structural|trivial
- FILE: {absolute path} | CHANGES: { ... } | CLASS: behavioral|structural|trivial
DIAGRAMS:
- {filename}: Implementing/Fix-Wave/{issue-slug}/{filename} (or \"none\" if structural/trivial)
  "
)
```

#### 4.2 Pair mode approval gate (pair mode only)

Check the `vibeinstructions` document for a `## Pair Mode` section. If absent or `Disabled`, skip this step and proceed directly to 4.3.

If Pair Mode is **Enabled**, present the fix wave approval gate after all research agents complete:

```
Fix wave research complete. Diagrams posted to collab for:
{list each behavioral file with its diagram name}

Review the diagrams in collab and respond:
- "approve" to proceed with implementation
- "reject" to stop and fix the plan
```

**Wait for human response before spawning any implement agents.**

- **approve** → proceed to 4.3
- **reject** → stop: "Fix wave halted. Review the diagrams and re-run /vibe-review."

#### 4.3 Dispatch IMPLEMENT agents

**Before dispatching implement agents, fire open-diff requests for each file in the fix wave:**

For each file path in the TASKS list across all research results, send a fire-and-forget POST to the IDE bridge:
```
POST /api/ide/open-diff
{ "filePath": "<absolute file path>" }
```
Failures are non-fatal; proceed regardless.

Collect all research results. Each research agent returned an `ISSUE_ID` and a list of file edits.

**Group by ISSUE_ID** — you need this mapping later to know when an issue is fully implemented.

**Spawn one IMPLEMENT agent per TASKS entry.**

For files with multiple TASKS entries (large file splits), spawn those agents SEQUENTIALLY — not in parallel — since they edit the same file. Agents for different files may still run in parallel.

```
Agent(
  model: "sonnet",
  description: "Edit {filename}",
  prompt: "
You are an IMPLEMENT agent. Make ONE specific edit to ONE file. Nothing else.

File: {absolute file path}
Changes: {specific changes from research agent}

RULES (these are strict — violations cause rejection):
- Use the Read tool to read files — NEVER use cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER use sed -i, awk, or shell redirects
- Use the Grep tool to search — NEVER use shell grep, rg, or find
- Use the Glob tool to find files — NEVER use ls or find
- Only use Bash for running build/test commands, NOTHING else

Steps:
1. Read the file with the Read tool
2. Make the edit with the Edit tool
3. Return what you changed

STATUS: done | failed
FILE: {absolute path}
ISSUE_ID: {issue-slug}
CONTEXT: { what was changed, any issues }
  "
)
```

#### 4.4 Chain VERIFY agents

As each implement agent returns, immediately spawn its paired VERIFY agent — do not wait for all implement agents to finish first.

```
Agent(
  model: "sonnet",
  description: "Verify {filename}",
  prompt: "
You are a VERIFY agent. Check that ONE file was implemented correctly. Do NOT make code edits.

Project: {project}
File: {absolute file path}
Expected change: {CHANGES from research result for this file}
Diagram: {diagram name from DIAGRAMS, or \"none\"}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Grep tool to search — NEVER shell grep or rg
- Only use Bash for build/test commands

Steps:
1. Read the current file state with the Read tool
2. Semantic review: does the file match the expected change? Check:
   - Was the correct function/block changed?
   - Does the logic match what was described?
   - Are there any obvious mistakes (wrong variable, missing return, logic inverted)?
3. Run TypeScript check: cd {project} && npx tsc --noEmit 2>&1 | head -30

If ALL checks pass:

STATUS: done
FILE: {absolute path}
ISSUE_ID: {issue-slug}

If ANY check fails:

STATUS: failed
FILE: {absolute path}
ISSUE_ID: {issue-slug}
CORRECTIONS:
- {specific correction 1 — re-state exactly what still needs to change, not just the error}
- {specific correction 2}
TSC_ERRORS: {relevant tsc lines, or \"none\"}
  "
)
```

#### 4.5 Per-file fix loop

For each file where verify returned `STATUS: failed`, enter a fix loop for that file independently. Other files are not blocked.

Track `previousErrors` per file (initially empty). On each verify failure for a file:

1. Compare current errors to `previousErrors` for that file
2. If errors are **identical** to previous iteration → stuck, escalate to user for that file only
3. If errors are **new or different** → making progress, spawn FIX agent

**FIX agent:**

```
Agent(
  model: "sonnet",
  description: "Fix {filename} (attempt [M])",
  prompt: "
You are a FIX agent. Apply the corrections below to ONE file. Do NOT run tests or verify.

File: {absolute file path}
Corrections:
{CORRECTIONS list from verify agent — these are re-stated instructions, not raw error messages}

TSC errors (if any):
{TSC_ERRORS from verify agent}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER sed -i or shell redirects
- Use the Grep tool to search — NEVER shell grep or rg
- Fix ONLY what the corrections specify — do not refactor or change anything else

Return:

STATUS: done | failed
FILE: {absolute path}
ISSUE_ID: {issue-slug}
CONTEXT: { what was fixed }
  "
)
```

After the FIX agent returns:
- If `STATUS: failed`: escalate to user for that file
- If `STATUS: done`: spawn VERIFY agent again for that file (same prompt as 4.4)
  - Set `previousErrors` to the current corrections before re-verifying
  - Loop until done or stuck

Stuck message per file:
```
File {filename} fix loop stuck — same errors after [M] attempts.

Corrections:
{correction details}

Fix this file manually and re-run /vibe-review, or skip and continue.
```

#### 4.6 Final TypeScript check

After ALL per-file verify+fix loops settle (all files either done or escalated), run a final tsc in the main context:

```bash
cd {project} && npx tsc --noEmit 2>&1 | head -50
```

- If **clean**: proceed to 4.7
- If **errors**: report to user and stop:
  ```
  Fix wave tsc failed after per-file verification.

  Errors:
  {tsc output}

  Fix these manually and re-run /vibe-review.
  ```

#### 4.7 Save fix-wave summary

```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "Implementing/Fix-Wave/summary",
  "content": "# Fix Wave Summary\n\n## Issues Fixed\n{issue slugs and what was done}\n\n## Files Changed\n{per-file implement + verify results}\n\n## Final TSC\n{clean | errors}"
}
```

---

### Case B: Only minor bugs found

Present the minor bugs and ask:
```
Minor issues found:
{list of minor bugs with file and description}

For each: Fix now / Add as todo / Accept risk
```
- For "Fix now": implement inline
- For "Add as todo": `mcp__plugin_mermaid-collab_mermaid__add_session_todo`
- For "Accept risk": note it and continue

### Case C: Everything clean

```
Both checks passed. Implementation looks solid.
```

## Step 5 — Archive blueprint when done

If the user confirms they are satisfied with the implementation, run the archive sweep:

1. Call `list_documents` to get all session documents
2. Collect:
   - **Set A:** documents where name starts with `Implementing/` AND NOT `Implementing/Ad-hoc/`
   - **Set B:** the `task-graph` root document (name === `task-graph`, not deprecated)
3. Determine slug: find the doc in Set A with `blueprint: true`, take segment after `Implementing/`. If none, use `unknown-${Date.now()}`.
4. For each doc in Set A: call `create_document` with name = `Archive/${slug}/` + (doc.name minus `Implementing/`) and same content
5. For the `task-graph` doc (Set B if present): call `create_document` with name = `Archive/${slug}/task-graph` and same content
6. Deprecate all originals: call `deprecate_artifact` with `deprecated: true` for each doc in Set A + Set B

Tell the user: `"Blueprint archived. The work is complete."`

**Auto-checkpoint:** Update the vibe instructions "Currently Doing" section:
1. Find and read the `vibeinstructions` document
2. Replace everything after `## Currently Doing` with:
   ```
   - Review complete — [bug count] bugs, [gap count] gaps
   - Blueprint archived
   - Implementation done — ready to commit
   ```
3. Write back with `update_document`
