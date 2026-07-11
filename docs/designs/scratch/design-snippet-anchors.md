# Design: Anchor-Based Snippet Extraction

## Problem
Claude is bad at counting line numbers. When creating snippets from source files, `startLine`/`endLine` frequently miss the target — grabbing wrong code, cutting off functions mid-body, etc. This also affects `apply_snippet` which uses stored line ranges to splice code back.

Additionally, MCP tools should not write directly to project source files. Claude has its own Edit tool for that — the MCP should manage session artifacts only.

## Goals
1. Replace line-number-based extraction with anchor-string matching
2. Remove all MCP tools that write to project source files
3. Works with any file type (TS, JSON, YAML, Markdown, config files, etc.)

## Proposed API

### `create_snippet` changes

Add new optional params, deprecate `startLine`/`endLine`:

```typescript
{
  // Existing
  project: string;
  session: string;
  name: string;
  content?: string;          // direct content (still supported)
  sourcePath?: string;       // file to extract from

  // New: anchor-based extraction (replaces startLine/endLine)
  startAt?: string;          // extract starting at the line containing this string (inclusive)
  endAt?: string;            // extract ending at the line containing this string (inclusive)

  // Safety
  maxLines?: number;         // max lines to extract (default 500)

  // Existing (keep)
  groupId?: string;
  groupName?: string;
}
```

**Behavior:**
- If `content` is provided: use it directly (no change)
- If `sourcePath` + no anchors: extract whole file (subject to maxLines)
- If `sourcePath` + `startAt` only: from matching line to end of file
- If `sourcePath` + `endAt` only: from start of file to matching line
- If `sourcePath` + both: range between matching lines (both inclusive)
- If `sourcePath` doesn't exist: error `"File not found: <path>. Use content param for new files."`

**Matching rules:**
- Search for the anchor string in each line (substring match via `includes()`)
- Both anchor and line are trimmed before comparison
- If 0 matches: error with suggestion
- If 2+ matches: error with line numbers and surrounding context
- Whitespace: trim both sides before comparing

**Single-line file detection:**
- If file has only 1 line (minified), error: `"File is a single line (<N> chars). Use content param instead of sourcePath with anchors."`

**Max range guard:**
- Default `maxLines` of 500
- If extracted range exceeds limit: error `"Extracted range is <N> lines (max <limit>). Increase maxLines or use narrower anchors."`

**Stored metadata:**
```json
{
  "language": "typescript",
  "code": "...",
  "filePath": "/path/to/source.ts",
  "startAt": "export function getSessionState",
  "endAt": "return state;",
  "originalCode": "..."
}
```

No line numbers stored. The anchors serve as human-readable bookmarks.

### Tools to remove (no MCP file writes to project source)

| Tool | Current behavior | Change |
|------|-----------------|--------|
| `apply_snippet` | Writes snippet code to source file at stored path/range | **Remove entirely** |
| `export_snippet` | Writes snippet to a file on disk | **Remove file write**, return content only |
| `export_design_code` | Writes generated code to `outputPath` | **Remove `outputPath` param**, return code string only |
| `export_design_svg` | Writes SVG to `outputPath` | **Remove `outputPath` param**, return SVG string only |

Claude uses its own Edit/Write tools to put content on disk.

### UI changes

The `SnippetEditor.tsx` has an "Apply to disk" button that calls `api.applySnippet()`. This must be removed since the backend tool is going away.

- Remove `applySnippet` from `ui/src/lib/api.ts`
- Remove the Apply button from `SnippetEditor.tsx`
- Keep the snippet editor's copy-to-clipboard functionality as the manual escape hatch

### `patch_snippet` changes

Currently line-number-based (takes `startLine`/`endLine` to splice within snippet content). Two options:

**Option A: Anchor-based patching (consistent)**
Same `startAt`/`endAt` matching but applied to the snippet's own stored `code` field instead of a source file. Replaces the matched range with new content.

**Option B: Full content replacement (simpler)**
Deprecate `patch_snippet` line-range editing. Use `update_snippet` with full content replacement. Claude reads the snippet, makes edits, writes the whole thing back.

**Recommendation:** Option B. Snippets are small (under 500 lines by design). Full replacement is simpler, avoids the anchor-within-snippet complexity, and Claude already has the content in context.

## Error Handling

| Scenario | Error message |
|----------|--------------|
| Anchor not found | `"startAt string not found in src/routes/api.ts"` |
| Multiple matches | `"startAt matched 5 locations in src/routes/api.ts. Lines: 12, 45, 89, 102, 156. Use more context."` |
| endAt before startAt | `"endAt appears at line 10 but startAt at line 20 — endAt must come after startAt"` |
| Adjacent/same line | `"startAt and endAt are on the same line — use content param instead"` |
| Binary file | `"File appears to be binary, skipping"` |
| File too large | `"File exceeds 1MB limit for snippet extraction"` |
| Single-line file | `"File is a single line. Use content param instead of anchors."` |
| Range too large | `"Extracted range is 800 lines (max 500). Increase maxLines or narrow anchors."` |
| File not found | `"File not found: <path>. Use content param for new files."` |

Note: Anchor strings in error messages should be sanitized (escape quotes/newlines) to prevent garbled output.

## Edge Cases
- Anchors inside comments/strings: Claude's responsibility to pick unique anchors
- Multiline anchors: Not supported — anchors match against individual lines
- Whitespace sensitivity: Trim before comparison
- File changes after creation: Anchors fail loudly (feature, not bug)
- CRLF vs LF: Normalize line endings before matching
- Special chars in anchors: Plain `includes()` match, no regex — safe for all characters
- New file workflow: `sourcePath` must exist; use `content` for new files
- Overloaded functions: Claude picks a longer anchor that includes the differentiating param

## Migration
- `startLine`/`endLine` params kept temporarily but deprecated — log warning if used
- `apply_snippet` removed (no skills reference it; UI button removed)
- Existing stored snippets with line numbers still render fine (they have `code` stored)
- `export_snippet`, `export_design_code`, `export_design_svg` lose file-write capability

## Files to Change

### Backend
- `src/mcp/tools/snippet.ts` — anchor extraction logic in create, remove apply, update export
- `src/mcp/setup.ts` — remove apply_snippet tool def, update create_snippet params, update exports
- `src/mcp/tools/design-ai.ts` — remove outputPath from export_design_code and export_design_svg
- `src/routes/api.ts` — remove apply-snippet API route if it exists

### UI
- `ui/src/components/snippet/SnippetEditor.tsx` — remove Apply to Disk button
- `ui/src/lib/api.ts` — remove applySnippet method

### Tests
- Update/remove tests for apply_snippet
- Add tests for anchor matching (0 match, 1 match, multi match, trimming, edge cases)

## Open Questions
1. Should `patch_snippet` switch to anchors or just full replacement? **Recommendation: full replacement (Option B)**
2. Should we store extracted line numbers as non-authoritative debugging hints? **Leaning no — they'd go stale and mislead**
3. Should we add a `refresh_snippet` tool that re-extracts using stored anchors? **Nice to have, not MVP**
