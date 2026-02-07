---
name: kodex-bootstrap-missing
description: Convert all missing topic flags into stub topics flagged as incomplete
user-invocable: true
model: haiku
allowed-tools:
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_flags
  - mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_flag_topic
---

# Kodex Bootstrap Missing

Batch-process all "missing" topic flags by creating stub topics and flagging them as incomplete.

## Overview

This skill quickly converts all open "missing" flags into stub topics, clearing the missing queue. Unlike `kodex-fix-missing` (which does full research for one topic), this creates minimal stubs that can be filled in later.

**Use when:**
- Many missing flags have accumulated
- Want to quickly establish topic structure
- Will fill in details later with `/kodex-fix`

**Comparison with related skills:**

| Skill | Behavior |
|-------|----------|
| `kodex-fix-missing` | One flag, full research, detailed content |
| `kodex-init` | Analyzes codebase, proposes topics |
| **`kodex-bootstrap-missing`** | Batch process, minimal stubs, quick conversion |

---

## Step 1: List Missing Flags

Retrieve all open flags and filter for type "missing":

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_list_flags
Args: {
  "project": "<cwd>",
  "status": "open"
}
```

Filter the results to only include flags where `type === "missing"`.

**If no missing flags found:**
```
No missing topic flags found. Nothing to bootstrap.
```
Exit skill.

---

## Step 2: Present for Confirmation

Display the missing topics to the user:

```
Found N missing topic flags to bootstrap:

1. topic-name-1: "Description from flag"
2. topic-name-2: "Description from flag"
...

This will create stub topics for each and flag them as incomplete.
```

Ask for approval:

```
Tool: AskUserQuestion
Args: {
  "questions": [{
    "question": "Create stub topics for all N missing flags?",
    "header": "Bootstrap",
    "options": [
      { "label": "Yes, create all", "description": "Create stub topics and flag as incomplete" },
      { "label": "No, cancel", "description": "Exit without changes" }
    ],
    "multiSelect": false
  }]
}
```

If user cancels, exit with:
```
Bootstrap cancelled. No topics created.
```

---

## Step 3: Create Stub Topics

For each missing flag, create a minimal stub topic:

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name-from-flag>",
  "title": "<Title Case of topic name>",
  "content": {
    "conceptual": "# <Title>\n\nTopic pending documentation.",
    "technical": "",
    "files": "",
    "related": ""
  }
}
```

**Title conversion:** Convert kebab-case to Title Case:
- `api-endpoints` → "Api Endpoints"
- `user-authentication` → "User Authentication"

Track successes and failures for the summary.

---

## Step 4: Flag as Incomplete

For each successfully created topic, flag it as incomplete:

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_flag_topic
Args: {
  "project": "<cwd>",
  "name": "<topic-name>",
  "type": "incomplete",
  "description": "Stub topic needs detailed content"
}
```

---

## Step 5: Summary

Display results:

```
Bootstrap complete!

Created N stub topics:
- topic-1: Title 1
- topic-2: Title 2
...

All topics flagged as incomplete.
Use /kodex-fix to fill in detailed content for each topic.
```

If any failures occurred:
```
Note: N topics failed to create:
- failed-topic: Error message
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No missing flags | Exit with message |
| User cancels | Exit with no changes |
| Topic already exists | Skip, note in summary |
| MCP tool fails | Log error, continue with remaining |

---

## MCP Tools Reference

| Tool | Purpose |
|------|---------|
| `kodex_list_flags` | Get all open missing flags |
| `kodex_create_topic` | Create stub topic as draft |
| `kodex_flag_topic` | Flag stub as incomplete |

---

## Integration

**Standalone skill** - Does not require an active collab session.

**Related skills:**
- `kodex-fix` - Fix flagged incomplete topics after bootstrap
- `kodex-fix-missing` - Detailed research for one missing topic
- `kodex-init` - Bootstrap from codebase analysis (not flags)
