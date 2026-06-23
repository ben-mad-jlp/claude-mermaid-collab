# Design: File-First Artifact Pivot

**Status:** Proposal  
**Date:** 2026-04-22

## Problem

Every MCP tool that creates or updates an artifact (`create_diagram`, `update_document`, `patch_snippet`, etc.) carries the full artifact content in the tool call payload. This content appears twice in Claude's context window — once as tool input, once as the server response — for every single operation.

For a session with 10–20 artifact operations, this burns 10k–100k tokens unnecessarily. It also makes large artifacts (design JSON, spreadsheets) expensive to iterate on.

## Proposed Solution

**File-first pattern:** Claude writes artifact content directly to disk using its native `Write`/`Edit` tools, then calls a lightweight `notify_artifact_updated` MCP tool. The server reads the file, validates it, updates its in-memory index, and broadcasts a WebSocket update to the UI.

This is already proven in the codebase: `sync_code_from_disk` implements exactly this pattern for linked code files.

### New workflow

```
Claude: Write(".collab/sessions/my-session/diagrams/arch.mmd", content)
  → PostToolUse hook fires → calls notify endpoint automatically
  → OR Claude: notify_artifact_updated(project, session, "diagram", "arch")
Server: reads file → validates → broadcasts diagram_updated WS event
UI: receives WS update → renders new content
```

### Context savings per operation

| Artifact type | Typical size | Savings per op |
|---|---|---|
| Mermaid diagram | 500–3,000 tokens | 1k–6k tokens |
| Document (markdown) | 500–5,000 tokens | 1k–10k tokens |
| Snippet | 200–2,000 tokens | 400–4k tokens |
| Design JSON | 2,000–15,000 tokens | 4k–30k tokens |
| Spreadsheet JSON | 1,000–10,000 tokens | 2k–20k tokens |

## File Layout (unchanged)

The directory structure already maps cleanly to artifact types. No migration needed.

```
.collab/sessions/{session}/
  diagrams/{id}.mmd
  documents/{id}.md
  snippets/{id}.snippet
  designs/{id}.design.json
  spreadsheets/{id}.spreadsheet
  embeds/{id}.embed.json
  images/{id}.*
  code-files/...
  metadata.json
```

IDs are deterministic sanitized names (`architecture`, `spec`, `auth-flow`), not UUIDs. Claude can construct the correct path without a lookup.

## Components to Build

### 1. `notify_artifact_updated` MCP tool

New tool modeled directly on `sync_code_from_disk`.

**Input:**
```ts
{
  project: string;
  session: string;
  type: 'diagram' | 'document' | 'snippet' | 'design' | 'spreadsheet' | 'embed';
  id: string;
  content_hash?: string; // optional: server verifies it read the right bytes
}
```

**Server behavior (`POST /api/artifact/notify`):**
1. Construct file path from `type` + `id` + session
2. Read file from disk
3. If `content_hash` provided, verify SHA-256 matches
4. Validate content (size ≤ 1MB, schema check for JSON types)
5. Update in-memory index (`lastModified`, cached content if applicable)
6. Broadcast appropriate WS message (`diagram_updated`, `document_updated`, etc.)
7. Return `{ success, id, type, lastModified }`

**Error cases:**
- File not found → `{ success: false, error: 'file_not_found' }` (Claude should check Write succeeded)
- Hash mismatch → `{ success: false, error: 'hash_mismatch' }` (OS flush race — Claude retries)
- Validation failure → `{ success: false, error: 'invalid_content', detail: '...' }` (Claude fixes and re-writes)

### 2. `register_artifact` MCP tool (for new artifacts only)

When Claude creates a **new** artifact, the server needs to register it (add to the session's artifact list, update `metadata.json`, assign the artifact to the session). This is separate from content notification.

**Input:**
```ts
{
  project: string;
  session: string;
  type: 'diagram' | 'document' | 'snippet' | 'design' | 'spreadsheet' | 'embed';
  id: string;       // desired ID / filename stem
  name: string;     // display name
}
```

**Server behavior (`POST /api/artifact/register`):**
1. Ensure session directory exists
2. Verify file already exists on disk (Claude must write before registering)
3. Register in MetadataManager (`metadata.json`)
4. Broadcast `{type}_created` WS message
5. Return `{ success, id, path }`

**Note:** For updates to existing artifacts, `register_artifact` is not needed — only `notify_artifact_updated`.

### 3. PostToolUse hook (automatic notification)

Configure in `.claude/settings.json` to fire after any `Write` or `Edit` call on a path matching `.collab/sessions/**`.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "scripts/notify-artifact.sh \"$TOOL_INPUT_FILE_PATH\""
          }
        ]
      }
    ]
  }
}
```

`scripts/notify-artifact.sh`:
- Parses the file path to extract `session`, `type`, `id`
- Calls `POST /api/artifact/notify` with those params
- Exits non-zero on failure so Claude Code surfaces the error

**Why hooks:** Subagents inherit hook config from `settings.json`. Any agent — main, spawned subagent, parallel worker — automatically triggers notify after a Write. Claude doesn't need to remember to call the tool.

**Hook vs explicit tool call:** Both work. The hook is the safety net. For new artifact creation, Claude still calls `register_artifact` explicitly (hook can't know it's a new artifact vs an update).

### 4. Deprecate content params from create/update tools

Existing tools keep their signatures but `content` becomes optional, defaulting to reading from disk:

```ts
// Old: required content
create_diagram(project, session, name, content: string)

// New: content optional — if omitted, reads from {id}.mmd already on disk
create_diagram(project, session, name, content?: string)
// If content provided: write-through (backwards compat)
// If content omitted: server reads from expected path (Claude must have written it)
```

This preserves backwards compatibility for existing skills that pass content inline.

## Skills That Need Updating

Each skill that calls content-bearing MCP tools should be updated to use the file-first pattern. Based on the inventory:

### High priority (large content, frequent use)
- `create_diagram` / `update_diagram` callers — diagrams are the most common artifact
- `update_document` / `patch_document` callers — documents can be large
- `create_design` / `update_design` callers — design JSON is the largest payload
- `batch_design_operations` — already uses delta ops; lower priority

### Medium priority
- `create_snippet` / `update_snippet` / `patch_snippet` — snippets are smaller
- `create_spreadsheet` / `update_spreadsheet` / `patch_spreadsheet`

### Low priority / no change needed
- `create_embed` — just a URL + name, minimal content
- `create_image` — binary/URL reference, not text content
- `create_code` / `sync_code_from_disk` — already uses file-first pattern
- `propose_code_edit` — pair mode flow, needs full content for diff

### Skills inventory to update

Review all `.skill.md` files in `skills/` that reference:
- `create_diagram`, `update_diagram`, `patch_diagram`
- `create_document`, `update_document`, `patch_document`
- `create_design`, `update_design`
- `create_snippet`, `update_snippet`, `patch_snippet`
- `create_spreadsheet`, `update_spreadsheet`

Each skill's instructions should be updated to say:
> "Write the file to `.collab/sessions/{session}/{type}/{id}.ext` first, then call `register_artifact` (new) or `notify_artifact_updated` (update)."

## What Does NOT Change

- `propose_code_edit` / `wait_for_edit_decision` — pair mode needs full content for diff
- `batch_design_operations` — delta ops are already more efficient than full-content updates; keep as-is or convert separately
- Add/update/remove design node tools — these are already fine-grained
- All read tools (`get_diagram`, `get_document`, etc.) — no change
- All delete tools — no change
- WS broadcast format — no change
- Client-side UI — no change (still receives same WS messages)

## Atomic Write Safety

To avoid the race where Claude calls `notify_artifact_updated` before the OS has flushed the Write:

1. The hook script adds a small `sync` call after the write (or uses `fsync` via a helper)
2. The `content_hash` param in `notify_artifact_updated` lets the server verify it read the same bytes Claude wrote — mismatch triggers a retry
3. In practice, Claude Code's `Write` tool is synchronous — by the time the tool returns and the hook fires, the file is flushed

## Migration Plan

1. **Phase 1:** Build `notify_artifact_updated` + `register_artifact` endpoints and MCP tools. Add PostToolUse hook config. No existing tools changed. Claude can start using the new pattern immediately.

2. **Phase 2:** Update skills one artifact type at a time, starting with diagrams (most common). Keep old content-bearing tools working for backward compat.

3. **Phase 3:** Make `content` optional in create/update tools (read-from-disk fallback). Deprecation warnings in tool descriptions.

4. **Phase 4:** Remove `content` params entirely once all skills are updated. Old tools become thin wrappers that call register + notify.

## Open Questions

- **`patch_diagram` / `patch_snippet` (search-replace ops):** These are useful for targeted edits without rewriting the full file. Should they stay as-is (they're already lower-context than full rewrites) or be replaced with `Edit` + notify?
  - Recommendation: Replace with `Edit` (Claude's native tool) + notify hook. More flexible, same context savings.

- **Design node ops (`add_design_node`, `update_design_node`):** These mutate structured JSON. Direct JSON editing is error-prone. Recommendation: keep these as-is; they're already fine-grained and the JSON structure is complex enough that server-side ops are safer.

- **History / versioning:** Current tools append to `.history/` on every write. The notify handler must also append to history so the timeline isn't lost.

- **Conflict detection:** `sync_code_from_disk` returns `{ hasLocalEdits, conflict }`. Should `notify_artifact_updated` do the same? Probably not needed for non-code artifacts since there's no "local edits" concept in the UI for diagrams/documents.
