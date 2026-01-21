---
name: collab-compact
description: Save context and trigger compaction for clean resume
user-invocable: true
---

# Collab Compact

Save current collab session context and trigger compaction for a clean context resume.

## When to Use

- Context is getting large and compaction is approaching
- Before a long break in the session
- Proactively to ensure clean state

## Process

### Step 1: Verify Active Session

```bash
ls -d .collab/*/ 2>/dev/null | xargs -I{} basename {}
```

If no sessions: "No active collab session. Use /collab first." STOP.
If multiple sessions: Ask user which session.

### Step 2: Save Context Snapshot

Read current state from `.collab/<session>/collab-state.json`.

Determine activeSkill from phase:
- "brainstorming" → activeSkill = "brainstorming"
- "rough-draft/*" → activeSkill = "rough-draft"
- "implementation" → activeSkill = "executing-plans"

Write snapshot to `.collab/<session>/context-snapshot.json`:

```json
{
  "version": 1,
  "timestamp": "<current-ISO-timestamp>",
  "activeSkill": "<determined-skill>",
  "currentStep": "<phase-from-state>",
  "pendingQuestion": null,
  "inProgressItem": <currentItem-from-state>,
  "recentContext": []
}
```

### Step 3: Update State

Update `.collab/<session>/collab-state.json`:
- Set `hasSnapshot: true`

### Step 4: Trigger Compaction

```
Context snapshot saved to .collab/<session>/context-snapshot.json

Triggering compaction now...
```

Invoke the /compact command.

### Step 5: Resume Instructions

After compaction, the conversation resumes. Instruct user:

```
Compaction complete. Run /collab to resume your session.
The snapshot will restore your context automatically.
```
