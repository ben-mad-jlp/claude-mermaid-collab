---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Systematic Debugging

## Collab Session Required

Before proceeding, check for active collab session:

1. Check if `.collab/` directory exists
2. Check if any session folders exist within
3. If no session found:
   ```
   ⚠️ No active collab session found.

   Use /collab to start a session first.
   ```
   **STOP** - do not proceed with this skill.

4. If multiple sessions exist, check `COLLAB_SESSION_PATH` env var or ask user which session.

## Get Current Work Item

After confirming collab session:

1. Read `collab-state.json` from the session folder
2. Get `currentItem` number from state
3. Read design doc and find the item with that number
4. Display: "Investigating: {item.title}"

This item context determines what bug is being investigated.

## EXPLICIT PROHIBITION

```
⚠️ DO NOT IMPLEMENT FIXES

- No editing source files to fix the bug
- No writing fix code
- Document only
- Fixes happen later via rough-draft → executing-plans
```

The following are FORBIDDEN in this skill:
- Using Edit tool on source files (except design doc)
- Using Write tool on source files
- Making any code changes to fix the bug
- Implementing the fix

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Manager wants it fixed NOW (systematic is faster than thrashing)

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - Does it happen every time?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather Evidence in Multi-Component Systems**

   **WHEN system has multiple components (CI → build → signing, API → service → database):**

   **BEFORE proposing fixes, add diagnostic instrumentation:**
   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify failing component
   THEN investigate that specific component
   ```

   **Example (multi-layer system):**
   ```bash
   # Layer 1: Workflow
   echo "=== Secrets available in workflow: ==="
   echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

   # Layer 2: Build script
   echo "=== Env vars in build script: ==="
   env | grep IDENTITY || echo "IDENTITY not in environment"

   # Layer 3: Signing script
   echo "=== Keychain state: ==="
   security list-keychains
   security find-identity -v

   # Layer 4: Actual signing
   codesign --sign "$IDENTITY" --verbose=4 "$APP"
   ```

   **This reveals:** Which layer fails (secrets → workflow ✓, workflow → build ✗)

5. **Trace Data Flow**

   **WHEN error is deep in call stack:**

   See `root-cause-tracing.md` in this directory for the complete backward tracing technique.

   **Quick version:**
   - Where does bad value originate?
   - What called this with bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find Working Examples**
   - Locate similar working code in same codebase
   - What works that's similar to what's broken?

2. **Compare Against References**
   - If implementing pattern, read reference implementation COMPLETELY
   - Don't skim - read every line
   - Understand the pattern fully before applying

3. **Identify Differences**
   - What's different between working and broken?
   - List every difference, however small
   - Don't assume "that can't matter"

4. **Understand Dependencies**
   - What other components does this need?
   - What settings, config, environment?
   - What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form Single Hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Write it down
   - Be specific, not vague

2. **Test Minimally (Read-Only)**
   - Use read-only checks to verify hypothesis
   - Can run tests, add logging, inspect state
   - CANNOT modify source files to test fixes
   - One hypothesis at a time

3. **Verify Before Continuing**
   - Root cause confirmed? Yes → Phase 4 (Document Findings)
   - Hypothesis disproven? Form NEW hypothesis
   - DON'T propose fixes yet - keep investigating

4. **When You Don't Know**
   - Say "I don't understand X"
   - Don't pretend to know
   - Ask for help
   - Research more

### Phase 4: Document Findings

**When root cause is found, document and return:**

1. **Update Work Item in Design Doc**

   Update the current work item with:
   - **Root Cause:** Clear explanation of what's wrong and why
   - **Approach:** Proposed fix strategy (without implementing)
   - **Success Criteria:** How to verify the fix worked

2. **Confirm Documentation**
   - Root cause is clearly explained
   - Approach is actionable for implementation phase
   - Success criteria are testable

3. **Return to Collab Skill**
   ```
   Root cause documented.
   Proposed fix approach documented.
   DO NOT IMPLEMENT - fixes happen in implementation phase.

   Returning to work item loop...
   ```

4. **If 3+ Hypotheses Failed: Question Architecture**

   **Pattern indicating architectural problem:**
   - Each hypothesis reveals new shared state/coupling/problem in different place
   - Proposed fixes would require "massive refactoring" to implement
   - Each investigation path creates new questions elsewhere

   **STOP and question fundamentals:**
   - Is this pattern fundamentally sound?
   - Are we "sticking with it through sheer inertia"?
   - Should we refactor architecture vs. continue investigating symptoms?

   **Discuss with your human partner before continuing**

   This is NOT a failed investigation - this may be a wrong architecture.
   Document architectural concerns in the work item and return to collab skill.

## Red Flags - STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

**If 3+ hypotheses failed:** Question the architecture (see Phase 4, step 4)

## your human partner's Signals You're Doing It Wrong

**Watch for these redirections:**
- "Is that not happening?" - You assumed without verifying
- "Will it show us...?" - You should have added evidence gathering
- "Stop guessing" - You're proposing fixes without understanding
- "Ultrathink this" - Question fundamentals, not just symptoms
- "We're stuck?" (frustrated) - Your approach isn't working

**When you see these:** STOP. Return to Phase 1.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Document** | Update design doc, return to collab | Root cause and approach documented |

## When Process Reveals "No Root Cause"

If systematic investigation reveals issue is truly environmental, timing-dependent, or external:

1. You've completed the investigation
2. Document what you investigated in the work item
3. Document recommended handling approach (retry, timeout, error message)
4. Document recommended monitoring/logging for future investigation
5. Return to collab skill with documented findings

**But:** 95% of "no root cause" cases are incomplete investigation.

## Snapshot Saving

Save context snapshots to enable recovery after compaction.

### When to Save

Call `saveSnapshot()` after:
- Phase 1 completes (root cause investigation done)
- Phase 2 completes (pattern analysis done)
- Phase 3 completes (hypothesis confirmed)
- Root cause documented in design doc (Phase 4 complete)
- Before returning to collab skill

### Save Function

```
FUNCTION saveSnapshot():
  session = current session name
  state = READ collab-state.json

  snapshot = {
    version: 1,
    timestamp: now(),
    activeSkill: "systematic-debugging",
    currentStep: state.phase (e.g., "debugging/phase-1", "debugging/phase-2", etc.),
    pendingQuestion: null,
    inProgressItem: currentItem,
    recentContext: []
  }

  WRITE to .collab/{session}/context-snapshot.json
  state.hasSnapshot = true
  WRITE state
```

### Save Points

**After Phase 1 (Root Cause Investigation) completes:**
```
[Phase 1 complete - root cause found]
→ Update collab-state.json phase to "debugging/phase-1-complete"
→ saveSnapshot()
→ Continue to Phase 2
```

**After Phase 2 (Pattern Analysis) completes:**
```
[Phase 2 complete - pattern analyzed]
→ Update collab-state.json phase to "debugging/phase-2-complete"
→ saveSnapshot()
→ Continue to Phase 3
```

**After Phase 3 (Hypothesis Testing) completes:**
```
[Phase 3 complete - hypothesis confirmed]
→ Update collab-state.json phase to "debugging/phase-3-complete"
→ saveSnapshot()
→ Continue to Phase 4
```

**After Phase 4 (Documentation) completes:**
```
[Phase 4 complete - root cause documented in design doc]
→ Update collab-state.json phase to "debugging/complete"
→ saveSnapshot()
→ Return to collab skill
```

---

## Supporting Techniques

These techniques are part of systematic debugging and available in this directory:

- **`root-cause-tracing.md`** - Trace bugs backward through call stack to find original trigger
- **`defense-in-depth.md`** - Add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** - Replace arbitrary timeouts with condition polling

**Related skills:**
- **superpowers:test-driven-development** - For creating failing test case (used during implementation phase, not this skill)
- **superpowers:verification-before-completion** - Verify fix worked (used during implementation phase, not this skill)

## Real-World Impact

From debugging sessions:
- Systematic approach: 15-30 minutes to fix
- Random fixes approach: 2-3 hours of thrashing
- First-time fix rate: 95% vs 40%
- New bugs introduced: Near zero vs common
