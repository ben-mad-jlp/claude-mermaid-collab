---
name: vibe-review
description: Run parallel bug and completeness review after vibe-go execution
user-invocable: true
model: sonnet
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
Find all `impl-*` documents and read them.

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
  "name": "review-bugs",
  "content": "# Bug Review\n\n[findings]"
}

Return: "Bug review complete. [N bugs found / No bugs found]. Saved to review-bugs."
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
  "name": "review-completeness",
  "content": "# Completeness Review\n\n[findings]"
}

Return: "Completeness review done. [N gaps found / Everything complete]. Saved to review-completeness."
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
- review-bugs — open in collab UI for full findings
- review-completeness — open in collab UI for full findings
```

## Step 4 — Gate on critical issues

**If critical bugs found:**
- Present each one and ask: Fix now / Add as todo / Accept risk / Dispute
- For "Fix": implement inline and re-run affected tests
- For "Add as todo": `mcp__plugin_mermaid-collab_mermaid__add_todo`
- For "Accept risk": note it and continue

**If completeness gaps found:**
- Present gaps and ask: Fix now (re-run `/vibe-go` for those tasks) / Accept / Defer
- If "Fix": user can say "go fix X" and `/vibe-go` runs for just those tasks

**If everything clean:**
```
Both checks passed. Implementation looks solid.
```

## Step 5 — Deprecate blueprint when done

If the user confirms they are satisfied with the implementation:

Mark the blueprint document as deprecated so it moves out of the active Blueprint section:

```
Tool: mcp__plugin_mermaid-collab_mermaid__deprecate_artifact
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "id": "<blueprint-doc-id>",
  "deprecated": true
}
```

Tell the user: "Blueprint archived. The work is complete."
