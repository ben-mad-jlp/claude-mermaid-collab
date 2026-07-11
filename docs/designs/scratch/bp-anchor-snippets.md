# Blueprint: Anchor-Based Snippet Extraction

## Source Artifacts
- design-snippet-anchors

---

## 1. Structure Summary

### Files

- [ ] `src/mcp/tools/snippet.ts` — Add anchor extraction logic to handleCreateSnippet, remove handleApplySnippet, remove outputPath from handleExportSnippet, deprecate patch_snippet line-range params
- [ ] `src/mcp/setup.ts` — Remove apply_snippet tool definition (lines 2043-2046) and handler (lines 3669-3674), update create_snippet schema, update export_snippet schema, update patch_snippet schema
- [ ] `src/mcp/tools/design-ai.ts` — Remove outputPath param and writeFile from handleExportDesignSvg (lines 1627-1629) and handleExportDesignCode (lines 1829-1831), update schemas (lines 1305-1326)
- [ ] `src/routes/api.ts` — Remove POST /api/snippet/:id/apply route (lines 1943-1989)
- [ ] `ui/src/components/editors/SnippetEditor.tsx` — Remove Apply to File button (lines 467-476), handleApply function (lines 273-296), isApplying/applyStatus state (lines 141-142), status message (lines 494-496)
- [ ] `ui/src/lib/api.ts` — Remove applySnippet interface declaration (line 86) and implementation (lines 657-665)

### Type Definitions

```typescript
// New anchor extraction params in createSnippetSchema
interface CreateSnippetParams {
  project: string;
  session?: string;
  todoId?: number;
  name?: string;
  content?: string;
  sourcePath?: string;
  startAt?: string;      // NEW: anchor string for range start (inclusive)
  endAt?: string;        // NEW: anchor string for range end (inclusive)
  maxLines?: number;     // NEW: safety cap (default 500)
  groupId?: string;
  groupName?: string;
  // DEPRECATED: startLine, endLine (kept for backwards compat, log warning)
}

// Stored snippet metadata (new format)
interface SnippetEnvelope {
  language: string;
  code: string;
  filePath?: string;
  startAt?: string;       // NEW: replaces startLine
  endAt?: string;         // NEW: replaces endLine
  originalCode?: string;
  groupId?: string;
  groupName?: string;
  annotations?: any[];
}
```

### Component Interactions

```
Claude reads source file → picks unique anchor strings
  → create_snippet(sourcePath, startAt, endAt)
    → snippet.ts finds anchor lines via includes()
    → extracts code between anchors (inclusive)
    → stores code + anchors in .snippet file
  → snippet visible in UI editor

Claude wants to apply changes:
  → reads snippet content
  → uses own Edit tool on source file
  (no MCP file writes)
```

---

## 2. Function Blueprints

### `findAnchorLine(lines: string[], anchor: string, label: string, filePath: string): number`

New helper function for anchor matching.

**Pseudocode:**
1. Trim the anchor string
2. For each line in the file, trim and check `includes(anchor)`
3. Collect all matching line indices
4. If 0 matches: throw error with anchor string and file path
5. If 2+ matches: throw error with line numbers and 1 line of context around each match
6. Return the single matching line index

**Error handling:** Descriptive errors with sanitized anchor strings
**Edge cases:** Empty anchor string → error. Anchor is entire line → works. Anchor contains special chars → safe (plain includes).
**Test strategy:** Unit tests for 0/1/N matches, whitespace trimming, special chars

### `extractWithAnchors(filePath: string, startAt?: string, endAt?: string, maxLines?: number): string`

New function to extract code from a file using anchors.

**Pseudocode:**
1. Read file content, normalize line endings (CRLF → LF)
2. Split into lines
3. If file has 1 line and anchors provided: error (minified file)
4. Determine start index: `startAt` ? `findAnchorLine(startAt)` : 0
5. Determine end index: `endAt` ? `findAnchorLine(endAt)` : lines.length - 1
6. If end < start: error (endAt before startAt)
7. If start === end and both anchors provided: extract that single line (valid)
8. Calculate range size: end - start + 1
9. If range > maxLines (default 500): error with count
10. Return lines.slice(start, end + 1).join('\n')

**Error handling:** All anchor errors bubble up from findAnchorLine
**Edge cases:** No anchors → whole file (subject to maxLines). Single anchor → half-range. Both same line → single line extract.
**Test strategy:** Parameterized tests for all anchor combinations, maxLines enforcement

### `handleCreateSnippet` — modification (lines 169-263)

**Changes:**
1. Accept new params: `startAt`, `endAt`, `maxLines`
2. If `startLine`/`endLine` provided: log deprecation warning, still work (backwards compat)
3. If `sourcePath` + anchors: call `extractWithAnchors` instead of line-slicing
4. Store `startAt`/`endAt` in snippet JSON instead of `startLine`/`endLine`
5. If `content` provided directly: no change

### `handleExportSnippet` — modification (lines 413-443)

**Changes:**
1. Remove `outputPath` param from schema and function signature
2. Remove `writeFile` call (lines 439-440)
3. Always return content as string in response
4. If format is 'json', return the full snippet JSON. If 'text', return just the code.

### `handleExportDesignSvg` — modification (lines 1601-1633)

**Changes:**
1. Remove `outputPath` param from schema (line 1309) and function signature
2. Remove the `if (outputPath)` block (lines 1627-1629)
3. Always return `{ success: true, svg }`

### `handleExportDesignCode` — modification (lines 1791-1835)

**Changes:**
1. Remove `outputPath` param from schema (line 1321) and function signature
2. Remove the `if (outputPath)` block (lines 1829-1831)
3. Always return `{ success: true, code }`

### `patchSnippet` — deprecation

**Changes:**
1. Log deprecation warning: "patch_snippet with line ranges is deprecated. Use update_snippet with full content instead."
2. Keep working for backwards compatibility
3. Update tool description in setup.ts to recommend update_snippet

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: anchor-extraction
    files: [src/mcp/tools/snippet.ts]
    tests: [src/mcp/tools/__tests__/snippet-anchors.test.ts]
    description: "Add findAnchorLine and extractWithAnchors functions, update handleCreateSnippet to use anchors, deprecate startLine/endLine"
    parallel: true
    depends-on: []

  - id: remove-apply-snippet
    files: [src/mcp/tools/snippet.ts, src/mcp/setup.ts, src/routes/api.ts]
    tests: []
    description: "Remove handleApplySnippet, apply_snippet tool definition, and POST /api/snippet/:id/apply route"
    parallel: true
    depends-on: []

  - id: remove-file-writes
    files: [src/mcp/tools/snippet.ts, src/mcp/tools/design-ai.ts, src/mcp/setup.ts]
    tests: []
    description: "Remove outputPath from export_snippet, export_design_code, export_design_svg; remove writeFile calls"
    parallel: true
    depends-on: []

  - id: remove-apply-ui
    files: [ui/src/components/editors/SnippetEditor.tsx, ui/src/lib/api.ts]
    tests: []
    description: "Remove Apply to File button, handleApply function, applySnippet API method"
    parallel: true
    depends-on: []

  - id: deprecate-patch-snippet
    files: [src/mcp/setup.ts]
    tests: []
    description: "Add deprecation warning to patch_snippet, update description to recommend update_snippet"
    parallel: false
    depends-on: [anchor-extraction]

  - id: update-schemas
    files: [src/mcp/setup.ts, src/mcp/tools/snippet.ts]
    tests: []
    description: "Update create_snippet schema to include startAt/endAt/maxLines params, remove startLine/endLine from schema (keep in handler for compat)"
    parallel: false
    depends-on: [anchor-extraction]

  - id: verify-build
    files: []
    tests: []
    description: "Run TypeScript build and tests to verify clean compilation"
    parallel: false
    depends-on: [anchor-extraction, remove-apply-snippet, remove-file-writes, remove-apply-ui, deprecate-patch-snippet, update-schemas]
```

### Execution Waves

**Wave 1 (parallel):**
- anchor-extraction, remove-apply-snippet, remove-file-writes, remove-apply-ui

**Wave 2 (depends on anchor-extraction):**
- deprecate-patch-snippet, update-schemas

**Wave 3 (depends on all):**
- verify-build

### Summary
- Total tasks: 7
- Total waves: 3
- Max parallelism: 4 (Wave 1)
