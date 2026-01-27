# Skeleton: Item 1 - Kodex Fix Skills

## Planned Files

- [ ] `skills/kodex-fix/SKILL.md` - Parent skill (user-invocable)
- [ ] `skills/kodex-fix-outdated/SKILL.md` - Sub-skill for outdated flags
- [ ] `skills/kodex-fix-incorrect/SKILL.md` - Sub-skill for incorrect flags
- [ ] `skills/kodex-fix-incomplete/SKILL.md` - Sub-skill for incomplete flags
- [ ] `skills/kodex-fix-missing/SKILL.md` - Sub-skill for missing flags
- [ ] `src/services/kodex-manager.ts` - Modify approveDraft() to auto-resolve flags

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

---

## File Contents

### Planned File: skills/kodex-fix/SKILL.md

```markdown
---
name: kodex-fix
description: Fix flagged Kodex topics by generating updated content
user-invocable: true
allowed-tools:
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_flags
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---

# Kodex Fix

Fix flagged Kodex topics by generating updated content.

## Overview

This skill lists open Kodex flags and routes to the appropriate sub-skill based on flag type. After the sub-skill creates a draft, the user can review and approve it in the Kodex UI.

**Use when:**
- You see open flags in the Kodex dashboard
- A topic has been flagged as outdated, incorrect, incomplete, or missing

---

## Step 1: List Open Flags

Query for open flags:

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_list_flags
Args: { "project": "<absolute-path-to-cwd>", "status": "open" }
\`\`\`

**If no open flags:**
\`\`\`
No open flags to fix.

Use the Kodex dashboard to view all flags or /kodex-init to create new topics.
\`\`\`
**STOP** - exit the skill.

---

## Step 2: Select Flag

Present flags to user:

\`\`\`
Open flags:

1. [outdated] topic-name: Description of the issue
2. [incorrect] another-topic: Description of the issue
3. [missing] new-topic: Description of the issue

Which flag do you want to fix?
\`\`\`

Use AskUserQuestion with multiple choice.

---

## Step 3: Route to Sub-Skill

Based on the selected flag's type:

| Flag Type | Sub-Skill |
|-----------|-----------|
| outdated | Invoke skill: kodex-fix-outdated |
| incorrect | Invoke skill: kodex-fix-incorrect |
| incomplete | Invoke skill: kodex-fix-incomplete |
| missing | Invoke skill: kodex-fix-missing |

Pass the topic name and flag description to the sub-skill.

---

## Step 4: Completion

After sub-skill returns:

\`\`\`
Draft created for [topic-name].

Review and approve the draft in the Kodex UI:
- Go to Kodex > Drafts
- Review the content
- Click "Approve" to publish (this will auto-resolve the flag)

Fix another flag?

1. Yes
2. No
\`\`\`

If user selects **1 (Yes)**: Return to Step 1
If user selects **2 (No)**: Exit skill

---

## Error Handling

| Error | Action |
|-------|--------|
| MCP tool failure | Display error, suggest retry |
| Flag not found | Refresh list, flag may have been resolved |

---

## Integration

**Standalone skill** - Does not require an active collab session.

**Related skills:**
- `kodex-fix-outdated` - Update stale content
- `kodex-fix-incorrect` - Fix factual errors
- `kodex-fix-incomplete` - Fill missing sections
- `kodex-fix-missing` - Create new topics
- `using-kodex` - Query and flag topics
- `kodex-init` - Bootstrap topic stubs
```

**Status:** [ ] Will be created during implementation

---

### Planned File: skills/kodex-fix-outdated/SKILL.md

```markdown
---
name: kodex-fix-outdated
description: Update outdated Kodex topic content by analyzing current codebase
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---

# Kodex Fix Outdated

Update outdated Kodex topic content by analyzing the current codebase.

## Overview

This sub-skill is invoked by `kodex-fix` when a topic is flagged as outdated. It reads the existing topic, analyzes the current codebase, and generates updated content.

---

## Step 1: Get Existing Topic

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "<topic-name>" }
\`\`\`

Extract:
- Current content (conceptual, technical, files, related)
- File paths from the 'files' section

**If topic not found:**
\`\`\`
Topic not found. This may need kodex-fix-missing instead.
\`\`\`
Return to parent skill.

---

## Step 2: Analyze Codebase

For each file in the topic's files section:
1. Check if file exists using Glob
2. Read file contents
3. Note any changes from what the topic describes

Search for related changes:
\`\`\`
Tool: Grep
Args: { "pattern": "<key-concept>", "path": "<project-root>" }
\`\`\`

Build understanding of current implementation vs documented state.

---

## Step 3: Generate Updated Content

Update each section based on current codebase state:

- **conceptual**: Update high-level overview
- **technical**: Update implementation details
- **files**: Add new files, remove deleted ones
- **related**: Verify related topics still exist

---

## Step 4: Validate with User

Present each updated section:

\`\`\`
**Conceptual (updated):**
[new content]

Does this look accurate?
1. Yes
2. No - needs changes
\`\`\`

If user selects **2**: Ask for corrections, regenerate.

---

## Step 5: Create Draft

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name>",
  "content": { "conceptual": "...", "technical": "...", "files": "...", "related": "..." },
  "reason": "Updated outdated content based on current codebase"
}
\`\`\`

Return to parent skill.

---

## Error Handling

| Error | Action |
|-------|--------|
| Topic not found | Return to parent, suggest kodex-fix-missing |
| Files not readable | Skip, note in content |
| User rejects content | Ask for corrections, regenerate |

---

## Integration

**Called by:** kodex-fix (parent skill)
**Returns to:** kodex-fix after creating draft
```

**Status:** [ ] Will be created during implementation

---

### Planned File: skills/kodex-fix-incorrect/SKILL.md

```markdown
---
name: kodex-fix-incorrect
description: Correct factually incorrect Kodex topic content
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---

# Kodex Fix Incorrect

Correct factually incorrect Kodex topic content.

## Overview

This sub-skill is invoked by `kodex-fix` when a topic is flagged as incorrect. It focuses on the specific inaccuracy described in the flag and verifies against actual code.

---

## Step 1: Get Existing Topic and Flag Details

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "<topic-name>" }
\`\`\`

Review the flag description to understand what's incorrect.

---

## Step 2: Verify the Inaccuracy

Read the files mentioned in the topic:
\`\`\`
Tool: Read
Args: { "file_path": "<file-from-topic>" }
\`\`\`

Compare:
- What the topic claims
- What the code actually does

Identify specific incorrect statements.

---

## Step 3: Research Correct Information

Use Grep to find actual implementations:
\`\`\`
Tool: Grep
Args: { "pattern": "<function-or-concept>", "path": "<project-root>" }
\`\`\`

Build accurate understanding of how things actually work.

---

## Step 4: Generate Corrected Content

Focus corrections on:
- The specific inaccuracy from the flag
- Any related incorrect statements discovered
- Keep accurate parts unchanged

---

## Step 5: Validate with User

\`\`\`
**Correction:**

The flag said: "[flag description]"
I found: "[actual behavior from code]"

Updated content:
[corrected section]

Is this correction accurate?
1. Yes
2. No - needs adjustment
\`\`\`

---

## Step 6: Create Draft

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name>",
  "content": { ... },
  "reason": "Corrected inaccuracy: [brief description]"
}
\`\`\`

Return to parent skill.

---

## Integration

**Called by:** kodex-fix (parent skill)
**Returns to:** kodex-fix after creating draft
```

**Status:** [ ] Will be created during implementation

---

### Planned File: skills/kodex-fix-incomplete/SKILL.md

```markdown
---
name: kodex-fix-incomplete
description: Fill in missing sections of incomplete Kodex topics
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---

# Kodex Fix Incomplete

Fill in missing sections of incomplete Kodex topics.

## Overview

This sub-skill is invoked by `kodex-fix` when a topic is flagged as incomplete. It identifies which sections are empty or sparse and fills them in.

---

## Step 1: Get Existing Topic

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "<topic-name>" }
\`\`\`

Identify which sections need content:
- conceptual: Empty or just placeholder text?
- technical: Empty or lacks detail?
- files: Missing file list?
- related: Missing related topics?

---

## Step 2: Gather Information for Missing Sections

For each empty/sparse section:

**conceptual (if empty):**
- Read main entry points
- Check for README in component directory
- Summarize purpose from code comments

**technical (if empty):**
- Analyze implementation patterns
- Document key functions and their purposes
- Note any gotchas or important details

**files (if empty):**
\`\`\`
Tool: Glob
Args: { "pattern": "**/*<topic-keyword>*" }
\`\`\`

**related (if empty):**
\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
Args: { "project": "<cwd>" }
\`\`\`
Find topics with related names or overlapping file paths.

---

## Step 3: Generate Content for Missing Sections

Only fill empty/sparse sections. Preserve existing content.

---

## Step 4: Validate with User

For each filled section:
\`\`\`
**[Section name] (new content):**
[generated content]

Does this accurately describe [topic]?
1. Yes
2. No - needs changes
\`\`\`

---

## Step 5: Create Draft

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_update_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name>",
  "content": { ... },
  "reason": "Filled incomplete sections: [list sections]"
}
\`\`\`

Return to parent skill.

---

## Integration

**Called by:** kodex-fix (parent skill)
**Returns to:** kodex-fix after creating draft
```

**Status:** [ ] Will be created during implementation

---

### Planned File: skills/kodex-fix-missing/SKILL.md

```markdown
---
name: kodex-fix-missing
description: Create new Kodex topics for missing documentation
user-invocable: false
allowed-tools:
  - Glob
  - Grep
  - Read
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---

# Kodex Fix Missing

Create new Kodex topics for missing documentation.

## Overview

This sub-skill is invoked by `kodex-fix` when a topic is flagged as missing. It researches the codebase to create a complete new topic.

---

## Step 1: Understand What's Needed

The flag description indicates what topic should exist.
Extract the topic name and any hints about what it should cover.

---

## Step 2: Research the Topic

Search for files matching the topic name:
\`\`\`
Tool: Glob
Args: { "pattern": "**/*<topic-name>*" }
\`\`\`

Search for references:
\`\`\`
Tool: Grep
Args: { "pattern": "<topic-keyword>", "path": "<project-root>" }
\`\`\`

Read relevant files to understand the component.

---

## Step 3: Identify Topic Scope

Determine:
- Which files belong to this topic?
- What is the main purpose?
- How does it relate to other components?

If unclear, ask user:
\`\`\`
I found these potential files for [topic]:
- path/to/file1.ts
- path/to/file2.ts

Should I include all of these, or is the scope different?
\`\`\`

---

## Step 4: Generate All 4 Sections

Create complete topic content:

- **conceptual**: High-level description
- **technical**: Implementation details, patterns, gotchas
- **files**: List of related source files
- **related**: Links to other Kodex topics

---

## Step 5: Validate with User

Present the full draft:
\`\`\`
**New Topic: [topic-name]**

[Full content preview]

Does this accurately describe [topic-name]?
1. Yes
2. No - needs changes
\`\`\`

---

## Step 6: Create Draft

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name>",
  "title": "<Topic Title>",
  "content": { "conceptual": "...", "technical": "...", "files": "...", "related": "..." }
}
\`\`\`

Return to parent skill.

---

## Error Handling

| Error | Action |
|-------|--------|
| No matching files | Ask user for guidance |
| Ambiguous scope | Present options, let user choose |
| Topic name too generic | Ask for clarification |

---

## Integration

**Called by:** kodex-fix (parent skill)
**Returns to:** kodex-fix after creating draft
```

**Status:** [ ] Will be created during implementation

---

### Planned Modification: src/services/kodex-manager.ts

**Location:** Inside `approveDraft()` method, after line 385

```typescript
// NEW CODE TO ADD (after existing logic that moves draft to live):

// Auto-resolve open flags for this topic
const openFlags = db.query(
  "SELECT id FROM flags WHERE topic_name = ? AND status = 'open'"
).all(topicName) as { id: number }[];

for (const flag of openFlags) {
  this.updateFlagStatus(flag.id, 'resolved');
}
```

**Status:** [ ] Will be modified during implementation

---

## Task Dependency Graph

```yaml
tasks:
  - id: kodex-fix-parent
    files: [skills/kodex-fix/SKILL.md]
    description: Create parent skill that lists flags and routes to sub-skills
    parallel: true

  - id: kodex-fix-outdated
    files: [skills/kodex-fix-outdated/SKILL.md]
    description: Create sub-skill for outdated flag type
    parallel: true

  - id: kodex-fix-incorrect
    files: [skills/kodex-fix-incorrect/SKILL.md]
    description: Create sub-skill for incorrect flag type
    parallel: true

  - id: kodex-fix-incomplete
    files: [skills/kodex-fix-incomplete/SKILL.md]
    description: Create sub-skill for incomplete flag type
    parallel: true

  - id: kodex-fix-missing
    files: [skills/kodex-fix-missing/SKILL.md]
    description: Create sub-skill for missing flag type
    parallel: true

  - id: kodex-manager-auto-resolve
    files: [src/services/kodex-manager.ts]
    description: Modify approveDraft() to auto-resolve flags
    parallel: true
```

---

## Execution Order

**Wave 1 (all parallel):**
All 6 tasks can run in parallel since they have no dependencies on each other:
- kodex-fix-parent
- kodex-fix-outdated
- kodex-fix-incorrect
- kodex-fix-incomplete
- kodex-fix-missing
- kodex-manager-auto-resolve

---

## Verification Checklist

- [x] All files from Interface are documented (5 skill files + 1 TS modification)
- [x] File paths match exactly (skills/kodex-fix-*/SKILL.md pattern)
- [x] All YAML frontmatter defined
- [x] All skill steps documented
- [x] TypeScript modification location specified (line 385)
- [x] Dependency graph covers all files
- [x] No circular dependencies (all parallel)
