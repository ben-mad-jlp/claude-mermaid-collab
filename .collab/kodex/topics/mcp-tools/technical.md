## Tool Naming Convention

All tools use **snake_case**:
- `generate_session_name`
- `create_diagram`
- `kodex_query_topic`
- `complete_skill`

## Common Parameter Patterns

```typescript
// Base session parameters
project: string  // Absolute path to project root
session: string  // Session name (e.g., "bright-calm-river")

// Resource ID
id: string  // Diagram/Document ID

// Content operations
name: string     // Resource name (without extension)
content: string  // Mermaid/Markdown content

// Patch operations
old_string: string  // Text to find (must be unique)
new_string: string  // Replacement text
```

## Response Patterns

```typescript
// Success
{ success: true, id: "...", previewUrl: "..." }

// Error
{ error: "Error message", isError: true }

// State
{
  phase: "brainstorming",
  currentItem: 1,
  hasSnapshot: true,
  workItems: [...]
}
```

## Key Tools

**Diagrams:**
- `create_diagram`, `update_diagram`, `patch_diagram`
- `validate_diagram` - Syntax check without saving
- `transpile_diagram` - SMACH output

**UI:**
- `render_ui` - Push UI to browser (blocking optional)
- `update_ui` - Partial patch
- `dismiss_ui` - Clear browser UI

**Kodex:**
- `kodex_query_topic` - Query with optional content
- `kodex_create_topic` / `kodex_update_topic` - Creates drafts
- `kodex_approve_draft` / `kodex_reject_draft` - Human review

**Workflow:**
- `complete_skill` - Report completion, get next skill