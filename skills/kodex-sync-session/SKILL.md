---
name: kodex-sync-session
description: Sync collab session artifacts into Kodex - automatically updates existing topics and creates new ones
user-invocable: false
allowed-tools:
  - Read
  - Glob
  - Grep
  - Agent
  - mcp__plugin_mermaid-collab_mermaid__get_session_state
  - mcp__plugin_mermaid-collab_mermaid__list_sessions
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
  - mcp__plugin_mermaid-collab_mermaid__kodex_query_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_direct_update_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_direct_create_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_flag_topic
  - mcp__plugin_mermaid-collab_mermaid__complete_skill
  - Bash
---

# Kodex Sync Session

Automatically sync collab session artifacts into the Kodex knowledge base at the end of a session. Updates existing topics and creates new ones based on session diagrams, documents, and designs.

**Announce at start:** "Syncing session artifacts to Kodex..."

## Overview

When a collab session ends, this skill:
1. Scans all session artifacts (diagrams, documents, designs)
2. **Verifies which artifacts were actually implemented** (not just brainstormed)
3. Semantically matches verified artifacts to existing Kodex topics
4. Updates matched topics directly (no draft — goes live immediately)
5. Creates new topics for unmatched feature areas
6. Flags all touched topics as `needs-review`
7. Copies diagram files to `.collab/kodex/diagrams/`

---

## Step 1: Identify Session and Gather Artifacts

### 1.1 Get Session Info

The session name and project path are provided by the calling skill (collab-cleanup). Use them to locate session artifacts.

```
Session path: <project>/.collab/sessions/<session>/
```

### 1.2 Scan Artifacts

Use `Glob` to discover all artifacts in the session:

```
Diagrams:  <project>/.collab/sessions/<session>/diagrams/*.mmd
Documents: <project>/.collab/sessions/<session>/documents/*.md
Designs:   <project>/.collab/sessions/<session>/designs/*.json
```

### 1.3 Read Artifact Content

For each artifact found:
- Read the file content
- Extract key information:
  - **Diagrams**: diagram type (flowchart, stateDiagram, wireframe, etc.), node labels, referenced components
  - **Documents**: section headings, file paths mentioned, feature names, component names
  - **Designs**: work item names, implementation details

### 1.4 Build Artifact Summary

Create a structured summary of what the session produced:
```
artifacts:
  - type: diagram
    file: packaging-state-machine.mmd
    keywords: [packaging, state machine, workflow, station]
    components: [PackagingContainer, usePackagingStation]
    files_mentioned: [src/features/packaging/]
  - type: document
    file: design.md
    keywords: [scale integration, bluetooth, websocket]
    components: [ScaleService, useScale]
    files_mentioned: [src/features/scale/useScale.ts]
```

---

## Step 2: Verify Artifacts Were Implemented

Not all session artifacts should be synced to Kodex. Brainstorming sessions produce exploratory diagrams and designs that may never be implemented. This step filters to only artifacts that represent real, implemented work.

### 2.1 Check Session State History

The session's `collab-state.json` reveals how far the session progressed:

| Session State | Artifact Status |
|---------------|----------------|
| Stayed in brainstorming phases (`exploring`, `clarifying`, `designing`, `validating`) | **Skip sync** — artifacts are exploratory only |
| Reached `rough-draft-blueprint` but not `executing-plans` | **Skip sync** — planned but not implemented |
| Reached `executing-plans` or beyond | **Likely implemented** — proceed with verification |
| Vibe mode with no state tracking | **Verify each artifact individually** (Step 2.3) |

If session never reached implementation phases, report "Session was brainstorming only — no artifacts synced to Kodex" and skip to Step 7 (Complete).

### 2.2 Check Git History for Implementation Evidence

Look for commits made during the session timeframe that touch files related to the artifacts:

```bash
# Get session creation time from metadata.json or collab-state.json
# Then check for related commits
git log --since="<session-start>" --name-only --oneline
```

Cross-reference changed files with artifact content:
- If a diagram describes `src/features/packaging/` and commits touched those files → **implemented**
- If a design doc describes a new API endpoint and the controller was created → **implemented**
- If no commits relate to the artifact → **not implemented**

### 2.3 Verify Codebase Presence

For each artifact, check if the things it describes actually exist:

**Diagrams:**
- State machine diagram → Check if the states/components it describes exist in code
  ```
  Glob: src/features/<feature>/**/*.ts
  Grep: state names from the diagram
  ```
- Dependency diagram → Check if the modules it shows exist
- Wireframe → Check if the screens/components it describes exist

**Design Documents:**
- Check if file paths mentioned in the design actually exist
- Check if components/hooks/services described were created
- Check if the feature directory exists

**Designs (JSON):**
- Check if work items are marked as completed in session state
- Cross-reference with `completedTasks` in `collab-state.json`

### 2.4 Classify Each Artifact

Mark each artifact as one of:
- **implemented** — evidence confirms it was built. Sync to Kodex.
- **partial** — some parts implemented, others not. Sync only the implemented parts.
- **brainstorm-only** — no implementation evidence. Skip.

Only proceed with `implemented` and `partial` artifacts.

### 2.5 Report Verification Results

```
Artifact verification:
  [implemented] packaging-state-machine.mmd — states found in src/features/packaging/
  [implemented] design.md (scale integration section) — useScale hook exists
  [brainstorm-only] alternative-nav-flow.mmd — no matching code found
  [brainstorm-only] design.md (future ideas section) — not implemented

Syncing 2 of 4 artifacts.
```

---

## Step 3: Get Existing Kodex Topics

### 2.1 List All Topics

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
Args: { "project": "<project-path>" }
```

### 2.2 Build Topic Index

For each topic, note:
- `name` — the topic identifier (e.g., "packaging", "scale")
- `title` — human-readable name
- `aliases` — alternate names for matching

---

## Step 4: Semantic Matching

Match each artifact to zero or more existing topics using these signals (in priority order):

### 3.1 Direct Name Match
- Artifact filename contains a topic name (e.g., `packaging-state-machine.mmd` matches topic `packaging`)
- Document mentions a topic name in headings or prominently

### 3.2 File Path Overlap
- Artifact mentions file paths that appear in a topic's `files.md`
- e.g., artifact references `src/features/picking/` → matches topic `picking`

### 3.3 Component/Keyword Overlap
- Artifact references components, hooks, services that appear in topic content
- e.g., artifact mentions `useStationMachine` → matches topic `qbs-scanner`

### 3.4 Feature Area Inference
- If artifact relates to a feature directory (`src/features/X/`), match to topic `X`
- If artifact relates to API controllers (`Controllers/X/`), match to topic `api-X`

### 3.5 Unmatched Artifacts

If an artifact doesn't match any existing topic with reasonable confidence:
- It's a candidate for a **new topic**
- Infer the topic name from:
  - The feature area mentioned
  - The diagram/document name
  - The primary subject matter

---

## Step 5: Update Existing Topics

For each matched topic, prepare updates:

### 4.1 Update diagrams.md

If the session produced diagrams relevant to this topic:

1. Copy `.mmd` files to `<project>/.collab/kodex/diagrams/` (create dir if needed)
2. Add links to the topic's `diagrams.md`:
   ```markdown
   - [Diagram Label](../../diagrams/filename.mmd) — Brief description
   ```
3. Don't duplicate links that already exist

### 4.2 Update conceptual.md (if session has design docs)

If session documents contain conceptual information (architecture decisions, design rationale) that should be added to the topic:
- Append new sections or update existing ones
- Preserve existing content — merge, don't replace
- Focus on new information the session produced

### 4.3 Update technical.md (if session has implementation details)

If session produced implementation details (API contracts, state machines, data flow):
- Append or update technical sections
- Include references to new diagrams

### 4.4 Update files.md (if new files were created)

If the session's implementation created new files relevant to this topic:
- Add them to the files listing

### 4.5 Apply Updates

For each topic that has changes, call:

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_direct_update_topic
Args: {
  "project": "<project-path>",
  "name": "<topic-name>",
  "content": {
    "diagrams": "<updated diagrams.md content>",
    ... (only include sections that changed)
  },
  "reason": "Updated from collab session '<session-name>': <brief description of what changed>"
}
```

This writes directly to live files (no draft) and flags the topic as `needs-review`.

---

## Step 6: Create New Topics

For unmatched artifacts that represent new feature areas:

### 5.1 Generate Topic Content

For each new topic, generate:
- **name**: kebab-case identifier (e.g., `unload-widget`)
- **title**: Human-readable title (e.g., "Unload Widget")
- **conceptual**: What it is, why it exists (from session design docs)
- **technical**: How it works (from session documents and diagrams)
- **files**: File paths if implementation exists
- **related**: Links to related topics discovered in matching
- **diagrams**: Links to session diagrams

### 5.2 Create Topic

```
Tool: mcp__plugin_mermaid-collab_mermaid__kodex_direct_create_topic
Args: {
  "project": "<project-path>",
  "name": "<topic-name>",
  "title": "<Topic Title>",
  "content": {
    "conceptual": "<content>",
    "technical": "<content>",
    "files": "<content>",
    "related": "<content>",
    "diagrams": "<content>"
  },
  "reason": "Auto-created from collab session '<session-name>'"
}
```

This creates the topic with confidence=`medium` and flags it as `needs-review`.

---

## Step 7: Report Summary

Display a summary of all changes:

```
Kodex Sync Complete

Updated topics (flagged for review):
  - packaging: +2 diagrams, updated technical section
  - scale: +1 diagram

Created topics (flagged for review):
  - unload-widget: new topic from session design

Diagrams copied to .collab/kodex/diagrams/:
  - packaging-state-machine.mmd
  - unload-widget-state-machine.mmd
  - unload-widget-all-screens.mmd

All touched topics flagged as needs-review.
```

---

## Step 8: Complete

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<project-path>", "session": "<session>", "skill": "kodex-sync-session" }
```

Handle response:
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Done

---

## Edge Cases

| Scenario | Action |
|----------|--------|
| No artifacts in session | Skip sync, report "No artifacts to sync" |
| No Kodex initialized | Skip sync, report "Kodex not initialized for this project" |
| Diagram already exists in kodex/diagrams/ | Overwrite with newer version |
| Topic already has same diagram link | Don't duplicate the link |
| Session has only lessons, no artifacts | Skip sync |
| Artifact matches multiple topics | Update all matched topics |

## Guidelines

- **Be conservative with content updates** — only update sections where the session produced genuinely new information
- **Be liberal with diagram links** — diagrams are always useful, add them even if the match is loose
- **Don't remove existing content** — only append or update, never delete what's already in a topic
- **Keep reason strings descriptive** — they appear in the Kodex UI flag list
- **Copy diagrams first, then update topics** — ensure .mmd files exist before linking

## Integration

**Called by:** `collab-cleanup` skill, before archiving/deleting the session

**Related skills:**
- `collab-cleanup` — parent skill that triggers this
- `kodex-fix-outdated` — manual topic update
- `kodex-fix-missing` — manual topic creation
- `using-kodex` — topic query and flagging
