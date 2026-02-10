---
name: executing-plans-bugreview
description: Systematic bug review of all implementation changes before declaring completion
user-invocable: false
model: sonnet
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Bug Review Phase

Systematic code review focused on bugs introduced during implementation. Runs after all tasks complete, before declaring implementation done.

**Core principle:** Catch bugs before they leave the implementation phase.

**Announce at start:** "I'm running a systematic bug review of all implementation changes."

## Step 1: Gather the Full Diff

Get the complete diff of all implementation changes:

```bash
# Find the commit before implementation started
BASE_SHA=$(git log --oneline --all | grep -m1 "rough-draft\|pre-implementation\|skeleton" | awk '{print $1}')

# If no marker commit found, use the diff against the base branch
if [ -z "$BASE_SHA" ]; then
  BASE_SHA=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || git rev-parse HEAD~10)
fi

HEAD_SHA=$(git rev-parse HEAD)

# Get the full diff and file list
git diff --stat $BASE_SHA..$HEAD_SHA
git diff $BASE_SHA..$HEAD_SHA
```

If the diff is too large (>500 lines), split by file and review in batches.

## Step 2: Dispatch Bug Review Agent

Spawn a Task agent (subagent_type: general-purpose) with the following prompt:

```
# Systematic Bug Review

You are reviewing implementation changes for introduced bugs. Your job is NOT to check design compliance (that's already done) — focus exclusively on correctness bugs.

## Git Range
Base: {BASE_SHA}
Head: {HEAD_SHA}

## Review Instructions

Run `git diff {BASE_SHA}..{HEAD_SHA}` and review ALL changed files.

For each file, systematically check for:

### Logic Bugs
- Off-by-one errors in loops, slices, array access
- Wrong comparison operators (< vs <=, == vs ===)
- Inverted boolean logic (! in wrong place, && vs ||)
- Missing break/return statements
- Unreachable code after early returns
- Integer overflow/underflow in arithmetic

### Null/Undefined Handling
- Accessing properties on potentially null/undefined values
- Missing null checks before dereferencing
- Optional chaining needed but not used
- Default values that hide bugs (|| vs ??)

### Error Handling
- Swallowed errors (empty catch blocks)
- Missing error propagation (async without await, missing .catch)
- Error messages that leak internal details
- Unclosed resources in error paths (files, connections, streams)

### Async/Concurrency
- Missing await on async calls
- Race conditions in shared state
- Promises that can reject without handler
- Concurrent modification of collections

### Data Integrity
- Mutation of input parameters (when immutability expected)
- Shallow copy when deep copy needed
- Type coercion bugs (string + number, loose equality)
- Missing validation at boundaries (user input, external API responses)

### Resource Management
- Unclosed file handles, connections, or streams
- Missing cleanup in finally blocks
- Event listeners added but never removed
- Timers/intervals started but never cleared

### Edge Cases
- Empty arrays/strings/objects not handled
- Negative numbers where only positive expected
- Very large inputs (performance/memory)
- Unicode/special characters in string operations

## Output Format

For each bug found:

```
### Bug {N}: {short title}

**Severity:** Critical | Important | Minor
**File:** {file_path}:{line_number}
**Category:** {from categories above}

**What's wrong:**
{Describe the bug precisely}

**Why it matters:**
{What could go wrong in practice}

**How to fix:**
{Specific fix, not vague}

**Code:**
```
{relevant code snippet}
```
```

### Severity Definitions
- **Critical**: Will cause crashes, data loss, or security issues in normal use
- **Important**: Will cause incorrect behavior in realistic edge cases
- **Minor**: Unlikely to cause issues but technically incorrect

### Rules
- Only report actual bugs, not style issues or design opinions
- Each finding must have a concrete scenario where it fails
- Don't report issues in test files unless they make tests unreliable
- If no bugs found, say so — don't invent issues to look thorough
```

## Step 3: Present Findings

Display the bug review results to the user.

**If no bugs found:**
```
Bug review complete — no issues found.
Ready to proceed to completion.
```
→ Return to executing-plans Step 5.

**If bugs found, present each one:**

```
## Bug Review Results

Found {N} potential bugs ({critical} critical, {important} important, {minor} minor).

{For each bug, show the agent's output}

### Decisions Needed

For each bug:
1. Fix - Address before completing
2. Add as Todo - Defer to a future session
3. Accept Risk - Proceed knowing this exists
4. Dispute - This is not actually a bug
```

## Step 4: Gate on Decisions

For each bug with severity Critical or Important:

1. Present the bug details
2. Ask user to decide: Fix, Add as Todo, Accept Risk, or Dispute

**If user chooses Fix:**
- Fix the bug inline (this is a bugfix, not a design change — no subagent needed)
- Run relevant tests to verify fix doesn't break anything
- Show the fix to the user

**If user chooses Add as Todo:**
- Create a project todo for future work:
  ```
  Tool: mcp__plugin_mermaid-collab_mermaid__add_todo
  Args: {
    "project": "<cwd>",
    "title": "Bug: {short title} in {file}"
  }
  ```
- Continue to next bug

**If user chooses Accept Risk:**
- Record as a lesson:
  ```
  Tool: mcp__plugin_mermaid-collab_mermaid__add_lesson
  Args: {
    "project": "<cwd>",
    "session": "<session>",
    "lesson": "Accepted risk: {bug description} in {file}. Reason: {user's reasoning}",
    "category": "gotcha"
  }
  ```
- Continue to next bug

**If user chooses Dispute:**
- User explains why it's not a bug
- If valid: skip it
- If unclear: discuss further

**Minor bugs:** Present as advisory list. Ask "Fix all / Add all as todos / Skip all?" If fix, fix all. If todos, create a todo for each. If skip, continue.

## Step 5: Verify Fixes

If any bugs were fixed:

```bash
npm run test:ci
```

**If tests pass:** Return to executing-plans Step 5.
**If tests fail:** Fix test failures, then return.

## Integration

**Called by:** executing-plans skill, after all tasks complete (Step 4.5)

**Collab workflow position:**
```
executing-plans:
  Step 1-1.8: Setup
  Step 2: Execute batches
  Step 3-4: Report and continue
  Step 4.5: Bug review ← (you are here)
  Step 5: Complete development
```
