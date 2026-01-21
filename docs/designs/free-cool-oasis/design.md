# Session: free-cool-oasis

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Allow user to pick session name
**Type:** feature
**Status:** documented
**Problem/Goal:**
Currently session names are auto-generated without user input. Users should be able to choose their own meaningful name if desired.

**Approach:**
Modify Step 3.2 in `skills/collab/skill.md`:
1. Generate a name using `mcp__mermaid__generate_session_name`
2. Present the generated name to the user with options:
   - "1. Use [generated-name]"
   - "2. Pick my own name"
3. If user picks option 2, prompt for custom name input
4. Validate custom name (alphanumeric + hyphens only, same as generated names)
5. If invalid, show error and re-prompt
6. Proceed with the chosen name

**Success Criteria:**
- User sees generated name before session is created
- User can accept generated name or enter custom name
- Custom names follow same validation rules as generated names
- Invalid names show clear error message and allow retry

**Decisions:**
- Present choice AFTER generating a name (show generated name, offer to use it or pick custom)
- Use same validation as generated names: alphanumeric + hyphens only

---

### Item 2: Task execution diagram timing issue
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
Task execution diagram only updates after all parallel tasks complete, not as individual tasks finish. Users cannot see real-time progress of individual tasks.

**Root Cause:**
The `executing-plans` skill (SKILL.md lines 272-278) updates the diagram only at batch boundaries:
1. Before spawning: sets ALL parallel tasks to "executing"  
2. After ALL complete: sets all to "completed/failed"

Individual Task agents have no instructions to update the diagram themselves. The orchestrator waits for all parallel Task tool calls to return before it can update anything.

**Approach:**
Two-part fix:

**Part A: Add `patch_diagram` MCP tool**
Add a new MCP tool `patch_diagram` in `src/mcp/server.ts` (similar to existing `patch_document`) that does search-replace on diagram content. This is safer for concurrent updates from parallel tasks.

Tool signature:
```
patch_diagram({ project, session, id, old_string, new_string })
```

Implementation: Copy `patchDocument` function, adapt for diagrams endpoint.

**Part B: Modify Task agent template**
Modify the Task agent prompt template in `skills/executing-plans/SKILL.md`:
1. Add project and session parameters to the template
2. Add instructions for task to use `patch_diagram` at START (set own task to "executing")
3. Add instructions for task to use `patch_diagram` at END (set own task to "completed" or "failed")
4. Keep orchestrator updates as fallback (in case task fails to update)

Template additions:
```
## Diagram Updates (REQUIRED)
Project: <project-path>
Session: <session-name>
Task ID: <task-id>

At START of implementation:
  mcp__mermaid__patch_diagram to change your task node style to executing

At END of implementation:
  mcp__mermaid__patch_diagram to change your task node style to completed (or failed)
```

**Success Criteria:**
- `patch_diagram` MCP tool works like `patch_document` but for diagrams
- Diagram shows individual task turning blue when that task starts
- Diagram shows individual task turning green when that task completes
- Updates happen in real-time, not waiting for batch completion
- Concurrent updates from parallel tasks don't overwrite each other
- Fallback still works if a task forgets to update

**Decisions:**
- Task agents self-update the diagram (simplest approach)
- Use `patch_diagram` for atomic style updates (safer for concurrency)
- Keep orchestrator batch updates as fallback

---

### Item 3: Add /collab command for users
**Type:** feature
**Status:** documented
**Problem/Goal:**
The `/collab` skill is not appearing in the slash command menu because the frontmatter uses `user_invocable` (underscore) instead of `user-invocable` (hyphen) as required by Claude Code.

**Approach:**
1. Fix frontmatter in `skills/collab/SKILL.md`: change `user_invocable: true` to `user-invocable: true`
2. Apply same fix to all other user-invocable skills in the plugin
3. Update README to document the command usage: `/mermaid-collab:collab`
4. Bump plugin version to trigger re-installation

Files to update:
- `skills/collab/SKILL.md` - fix frontmatter
- Any other skills with `user_invocable` - fix frontmatter
- `README.md` - document `/mermaid-collab:collab` command

**Success Criteria:**
- `/mermaid-collab:collab` appears in slash command autocomplete
- Running `/mermaid-collab:collab` launches the collab skill correctly
- README documents how to use the command

**Decisions:**
- Use namespaced command `/mermaid-collab:collab` (plugin standard)
- Fix frontmatter syntax (hyphen not underscore)

---

### Item 4: Review Claude Code skills documentation
**Type:** spike
**Status:** documented
**Problem/Goal:**
Review Claude Code skills documentation to identify settings we should add to our skills for better UX and efficiency.

**Findings:**
Available frontmatter fields from Claude Code docs:
- `name` - skill name (currently used)
- `description` - skill description (currently used)  
- `user-invocable` - show in / menu (currently using wrong syntax)
- `argument-hint` - autocomplete hints (NOT used)
- `allowed-tools` - tools Claude can use WITHOUT asking permission when skill is active (NOT used)
- `model` - specify model to use (NOT used)
- `context` - fork for subagent isolation (NOT used)
- `agent` - subagent type (NOT used)
- `hooks` - skill-scoped hooks (NOT used)
- `disable-model-invocation` - prevent auto-trigger (NOT used)

**Approach:**
Add two new settings to optimize skill execution:

1. **`allowed-tools`** - Allow tools to run without permission prompts, tailored per skill:
   - Design skills: mermaid MCP, Read, Glob, Grep
   - Implementation skills: mermaid MCP, Read, Glob, Grep, Task
   - gather-session-goals: mermaid MCP, Read (minimal - just needs doc updates)

2. **`model`** - Use different models for different phases:
   - Opus for design/brainstorming skills (better creative reasoning)
   - Haiku for implementation skills (faster, more economical)

Skill-specific tool access:
| Skill | Model | Allowed Tools |
|-------|-------|---------------|
| collab | - | mermaid MCP, Read, Glob, Grep |
| brainstorming | opus | mermaid MCP, Read, Glob, Grep |
| rough-draft | opus | mermaid MCP, Read, Glob, Grep |
| gather-session-goals | opus | mermaid MCP, Read |
| executing-plans | haiku | mermaid MCP, Read, Glob, Grep, Task |
| subagent-driven-development | haiku | mermaid MCP, Read, Glob, Grep, Task |

**Success Criteria:**
- Skills use appropriate models for their purpose
- Design phases use Opus for better reasoning
- Implementation phases use Haiku for speed/cost
- Tools run without permission prompts during collab workflows
- Each skill has only the tools it actually needs

**Decisions:**
- Use `model: opus` for design-focused skills
- Use `model: haiku` for implementation-focused skills
- Tailor `allowed-tools` per skill based on actual usage

---

## Interface Definition

### File Structure

Files to be modified:

| File | Change Type | Description |
|------|-------------|-------------|
| `src/mcp/server.ts` | Modify | Add `patch_diagram` MCP tool |
| `skills/collab/SKILL.md` | Modify | Fix frontmatter, add name choice flow, add allowed-tools |
| `skills/executing-plans/SKILL.md` | Modify | Add diagram update instructions, model: haiku, allowed-tools |
| `skills/brainstorming/SKILL.md` | Modify | Add `model: opus`, allowed-tools |
| `skills/rough-draft/SKILL.md` | Modify | Add `model: opus`, allowed-tools |
| `skills/gather-session-goals/SKILL.md` | Modify | Add `model: opus`, allowed-tools |
| `skills/subagent-driven-development/SKILL.md` | Modify | Add `model: haiku`, allowed-tools |
| `README.md` | Modify | Document `/mermaid-collab:collab` command |
| `.claude-plugin/plugin.json` | Modify | Bump version |

### New MCP Tool

**patch_diagram** - Apply search-replace patch to a diagram

```typescript
// Tool definition
{
  name: 'patch_diagram',
  description: 'Apply a search-replace patch to a diagram. More efficient than update_diagram for small changes. Fails if old_string is not found or matches multiple locations.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to the project root' },
      session: { type: 'string', description: 'Session name' },
      id: { type: 'string', description: 'The diagram ID' },
      old_string: { type: 'string', description: 'Text to find' },
      new_string: { type: 'string', description: 'Text to replace with' },
    },
    required: ['project', 'session', 'id', 'old_string', 'new_string'],
  },
}
```

### Frontmatter Schema Changes

**collab/SKILL.md:**
```yaml
---
name: collab
description: Use when starting collaborative design work...
user-invocable: true
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
---
```

**brainstorming/SKILL.md:**
```yaml
---
name: brainstorming
description: ...
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
---
```

**rough-draft/SKILL.md:**
```yaml
---
name: rough-draft
description: ...
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
---
```

**gather-session-goals/SKILL.md:**
```yaml
---
name: gather-session-goals
description: ...
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
---
```

**executing-plans/SKILL.md:**
```yaml
---
name: executing-plans
description: ...
model: haiku
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
  - Task
---
```

**subagent-driven-development/SKILL.md:**
```yaml
---
name: subagent-driven-development
description: ...
model: haiku
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
  - Task
---
```

### Section Changes

**collab/SKILL.md - Step 3.2:**
- Current: Auto-generates name, proceeds immediately
- New: Generate name → Present choice → Handle custom name input → Validate → Proceed

**executing-plans/SKILL.md - Task agent prompt template:**
- Current: No diagram update instructions
- New: Add "Diagram Updates (REQUIRED)" section with `patch_diagram` calls

---

## Pseudocode

### src/mcp/server.ts - Add patch_diagram

**Add patchDiagram function (after patchDocument function, ~line 286):**

```typescript
async function patchDiagram(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  // First, get the current diagram content
  const getResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${getResponse.statusText}`);
  }

  const diagram = await getResponse.json();
  const currentContent = diagram.content;

  // Check if old_string exists and is unique
  const occurrences = currentContent.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in diagram: "${oldString.slice(0, 50)}..."`);
  }
  if (occurrences > 1) {
    throw new Error(`old_string found ${occurrences} times - must be unique. Add more context to make it unique.`);
  }

  // Apply the replacement
  const updatedContent = currentContent.replace(oldString, newString);

  // Update the diagram
  const updateResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updatedContent,
      patch: { oldString, newString }  // Include patch info for WebSocket broadcast
    }),
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to patch diagram: ${error.error || updateResponse.statusText}`);
  }

  // Generate a preview snippet around the change
  const changeIndex = updatedContent.indexOf(newString);
  const previewStart = Math.max(0, changeIndex - 50);
  const previewEnd = Math.min(updatedContent.length, changeIndex + newString.length + 50);
  const preview = updatedContent.slice(previewStart, previewEnd);

  return JSON.stringify({
    success: true,
    id,
    message: 'Diagram patched successfully',
    preview: `...${preview}...`,
  }, null, 2);
}
```

**Add tool definition (in tools array, after patch_document):**

```typescript
{
  name: 'patch_diagram',
  description: 'Apply a search-replace patch to a diagram. More efficient than update_diagram for small changes. Fails if old_string is not found or matches multiple locations.',
  inputSchema: {
    type: 'object',
    properties: {
      ...sessionParamsDesc,
      id: { type: 'string', description: 'The diagram ID' },
      old_string: { type: 'string', description: 'Text to find (must be unique in diagram)' },
      new_string: { type: 'string', description: 'Text to replace with' },
    },
    required: ['project', 'session', 'id', 'old_string', 'new_string'],
  },
},
```

**Add case handler (in switch statement, after patch_document case):**

```typescript
case 'patch_diagram': {
  const { project, session, id, old_string, new_string } = args as { project: string; session: string; id: string; old_string: string; new_string: string };
  if (!project || !session || !id || !old_string || new_string === undefined) throw new Error('Missing required: project, session, id, old_string, new_string');
  return await patchDiagram(project, session, id, old_string, new_string);
}
```

### collab/SKILL.md - Step 3.2 Changes

**Current Step 3.2:**
```
### 3.2 Generate Name

Use the MCP tool to generate a memorable name:

Tool: mcp__mermaid__generate_session_name
Args: {}

Returns: { name: "bright-calm-river" }
```

**New Step 3.2 (replace entirely):**
```
### 3.2 Generate or Choose Name

1. Generate a suggested name:
   Tool: mcp__mermaid__generate_session_name
   Args: {}
   Returns: { name: "bright-calm-river" }

2. Present options to user:
   ```
   Generated session name: bright-calm-river

   1. Use this name
   2. Pick my own name

   Select option (1-2):
   ```

3. If user selects "1. Use this name":
   - Use the generated name
   - Continue to Step 3.3

4. If user selects "2. Pick my own name":
   a. Prompt: "Enter session name (alphanumeric and hyphens only):"
   b. Validate input:
      - Must match pattern: /^[a-zA-Z0-9-]+$/
      - Must not be empty
   c. If invalid:
      - Show error: "Invalid name. Use only letters, numbers, and hyphens."
      - Return to step 4a (re-prompt)
   d. If valid:
      - Use the custom name
      - Continue to Step 3.3
```

### executing-plans/SKILL.md - Task Agent Template Changes

**Find the "Task agent prompt template" section (around line 286-319)**

**Add after "## Instructions" section:**
```
## Diagram Updates (REQUIRED)

**Collab Info:**
- Project: <project-path>
- Session: <session-name>
- Task ID: <task-id>

**At START of implementation (BEFORE writing any code):**

Use patch_diagram to update your task style to "executing":

Tool: mcp__mermaid__patch_diagram
Args: {
  "project": "<project-path>",
  "session": "<session-name>",
  "id": "task-execution",
  "old_string": "style <task-id> fill:#fff",
  "new_string": "style <task-id> fill:#bbdefb,stroke:#1976d2,stroke-width:3px"
}

**At END of implementation (AFTER all code written and tests pass):**

Use patch_diagram to update your task style to "completed" (or "failed"):

Tool: mcp__mermaid__patch_diagram
Args: {
  "project": "<project-path>",
  "session": "<session-name>",
  "id": "task-execution",
  "old_string": "style <task-id> fill:#bbdefb,stroke:#1976d2,stroke-width:3px",
  "new_string": "style <task-id> fill:#c8e6c9,stroke:#2e7d32"
}

OR if task failed:
Args: {
  "old_string": "style <task-id> fill:#bbdefb,stroke:#1976d2,stroke-width:3px",
  "new_string": "style <task-id> fill:#ffcdd2,stroke:#c62828"
}

**This is MANDATORY. Do not skip diagram updates.**
```

### Frontmatter Changes (Per-Skill)

**collab/SKILL.md:**
```yaml
# FIND:
---
name: collab
description: Use when starting collaborative design work - creates isolated collab sessions with mermaid-collab server
user_invocable: true
---

# REPLACE WITH:
---
name: collab
description: Use when starting collaborative design work - creates isolated collab sessions with mermaid-collab server
user-invocable: true
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
---
```

**brainstorming/SKILL.md:**
```yaml
# ADD after existing frontmatter fields:
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
```

**rough-draft/SKILL.md:**
```yaml
# ADD after existing frontmatter fields:
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
```

**gather-session-goals/SKILL.md:**
```yaml
# ADD after existing frontmatter fields:
model: opus
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
```

**executing-plans/SKILL.md:**
```yaml
# ADD after existing frontmatter fields:
model: haiku
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
  - Task
```

**subagent-driven-development/SKILL.md:**
```yaml
# ADD after existing frontmatter fields:
model: haiku
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
  - Task
```

### README.md Changes

**Add a new section "## Slash Commands":**
```markdown
## Slash Commands

The plugin provides the following slash command:

### `/mermaid-collab:collab`

Start or resume a collaborative design session. This is the main entry point for the collab workflow.

**Usage:**
```
/mermaid-collab:collab
```

The command will:
1. Check if the mermaid-collab server is running
2. List existing sessions or create a new one
3. Guide you through the collaborative design workflow
```

### plugin.json Changes

**Bump version from 5.6.0 to 5.7.0:**
```json
{
  "version": "5.7.0"
}
```

---

## Skeleton

### Task Dependency Graph

```yaml
tasks:
  - id: patch-diagram-mcp
    files: [src/mcp/server.ts]
    description: Add patch_diagram MCP tool
    parallel: true

  - id: collab-frontmatter
    files: [skills/collab/SKILL.md]
    description: Fix frontmatter and add name choice flow
    parallel: true

  - id: brainstorming-frontmatter
    files: [skills/brainstorming/SKILL.md]
    description: Add model and allowed-tools to frontmatter
    parallel: true

  - id: rough-draft-frontmatter
    files: [skills/rough-draft/SKILL.md]
    description: Add model and allowed-tools to frontmatter
    parallel: true

  - id: gather-session-goals-frontmatter
    files: [skills/gather-session-goals/SKILL.md]
    description: Add model and allowed-tools to frontmatter
    parallel: true

  - id: executing-plans-updates
    files: [skills/executing-plans/SKILL.md]
    description: Add frontmatter and diagram update instructions
    parallel: true

  - id: subagent-driven-dev-frontmatter
    files: [skills/subagent-driven-development/SKILL.md]
    description: Add model and allowed-tools to frontmatter
    parallel: true

  - id: readme-slash-commands
    files: [README.md]
    description: Document slash commands
    parallel: true

  - id: bump-version
    files: [.claude-plugin/plugin.json]
    description: Bump version to 5.7.0
    depends-on: [patch-diagram-mcp, collab-frontmatter, brainstorming-frontmatter, rough-draft-frontmatter, gather-session-goals-frontmatter, executing-plans-updates, subagent-driven-dev-frontmatter, readme-slash-commands]
```

### Execution Order

**Parallel Batch 1** (all independent):
- patch-diagram-mcp
- collab-frontmatter
- brainstorming-frontmatter
- rough-draft-frontmatter
- gather-session-goals-frontmatter
- executing-plans-updates
- subagent-driven-dev-frontmatter
- readme-slash-commands

**Batch 2** (after all batch 1 complete):
- bump-version

---

## Diagrams
(auto-synced)