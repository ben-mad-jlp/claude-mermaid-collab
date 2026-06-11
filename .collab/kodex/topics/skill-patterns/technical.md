## YAML Frontmatter Structure

```yaml
---
name: skill-identifier          # Required: kebab-case
description: Brief purpose       # Required: one-line
user-invocable: true|false       # Required: can users invoke directly
allowed-tools: [list of tools]   # Optional: authorized tools
model: haiku|default             # Optional: model preference
---
```

## Common Markdown Sections

1. **Overview/Purpose** - Clear intent statement
2. **When to Use** - Invocation criteria
3. **Process/Steps** - Numbered steps with substeps
4. **Tool Invocations** - Pseudocode format:
   ```
   Tool: tool-name
   Args: { "param": "value" }
   ```
5. **Verification/Checkpoints** - Gates before proceeding
6. **Completion** - Routing to next skill

## Step Patterns

**Pre-Flight Check:**
```
Step 0: Verify prerequisites
IF missing: STOP with message
ELSE: Proceed
```

**Iterative Discussion:**
```
FOR EACH work item:
  Present item
  Ask clarifying questions
  Update design doc
AFTER all: Confirm nothing else needed
```

**Design Freeze Gate:**
```
BEFORE execution: Verify design complete
DURING: Reject changes, document for later
AFTER: Optional improvements via formal process
```

**Completion Routing:**
```
At skill end:
  Call complete_skill with MCP
  MCP returns next_skill
  Route accordingly
```

## Invocation Chain

```
collab → gather-session-goals → brainstorming-* phases
       → rough-draft-* phases → executing-plans
       → finishing-a-development-branch → collab-cleanup
```