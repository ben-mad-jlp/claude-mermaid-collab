# Migration Plan — Code Artifact Features + Pseudo-DB Overhaul

Synthesizing the findings from `feature-brainstorm` and `pseudo-db-audit` into a single executable roadmap.

## Overview

This plan delivers the Code Artifact feature set in five phases. Phase 1 gives immediate user-facing value with no risky dependencies. Phase 2 delivers the core Claude-driven editing workflow. Phase 3 is a focused pseudo-db overhaul that fixes real bugs AND unlocks the navigation features. Phases 4 and 5 layer on navigation features that depend on Phase 3's foundation.

### Philosophy

- **Ship value early, ship bugs fixes always.** Phase 1 + Phase 2 are deployable independently. Phase 3 fixes bugs that exist today.
- **Build enablers before features.** Pseudo-db overhaul is treated as a single focused piece of work before navigation features are attempted.
- **Don't block low-value features behind high-value ones.** Phase 1 ships in parallel with Phase 3 planning.
- **Shared helpers reduce redundant work.** Feature A's symbol extractor is reused by Show References and Feature B.

---

## Dependency Graph

```
Phase 1 (Independent)            Phase 3 (Enabler — can run in parallel with 1 & 2)
├─ Diff Against Disk             └─ Pseudo-DB Overhaul
├─ Kebab Menu                        ├─ Schema extension
└─ Open Pseudo Side-by-Side          ├─ Parser overhaul
        │                            ├─ Skill updates
        ▼                            ├─ Bug fixes
Phase 2 (needs Diff)                 └─ New source-link endpoint
└─ Claude MCP Edit Artifact Tool             │
                                              ▼
                                    Phase 4 (needs Phase 3)
                                    ├─ Feature A: Function Jump Dropdown
                                    └─ Show References
                                              │
                                              ▼
                                    Phase 5 (needs Feature A)
                                    ├─ Feature B: Cross-File Navigation
                                    └─ Cross-Artifact Code Search (independent)
```

**Critical path:** Phase 3 → Feature A → Feature B. Everything else can ship as soon as its dependencies are met.

---

## Phase 1: Foundation (No Dependencies)

Three independent UI features that each deliver immediate value. Can be built in parallel.

### 1.1 Diff Against Disk ⭐ HIGH VALUE / LOW EFFORT

**Goal:** Before pushing edits to disk, show a unified diff of the in-editor buffer vs. the current on-disk content of the linked file.

**Why this first:**
- Directly improves the Push flow (current confirm dialog is bare)
- Reduces "fear of overwriting" — the single biggest UX friction with linked files today
- Uses an existing dependency (`@codemirror/merge` is likely already available; if not, it's a clean add)
- Zero risk to other features

**Tasks:**
1. Install `@codemirror/merge` if not already present
2. Create `ui/src/components/editors/DiffAgainstDiskView.tsx` — renders a merge view comparing `envelope.code` vs `envelope.diskCode`
3. Add a "Preview Diff" button to the CodeEditor toolbar that opens the diff in an overlay or expands the editor pane
4. Wire the existing Push button to show the diff as the confirmation step (replace `window.confirm` with a proper diff preview modal)
5. On sync, if `envelope.diskCode` is stale, prompt to refresh it first

**Files touched:**
- `ui/src/components/editors/CodeEditor.tsx`
- `ui/src/components/editors/DiffAgainstDiskView.tsx` (new)
- `package.json` (if installing `@codemirror/merge`)

**Validation:**
- Edit a linked code file, click Push — see a diff preview before confirming
- Sync from disk, then Push — diff reflects current disk state
- Confirm the diff renders for TS, JS, Python, and plain text files

### 1.2 Quick-Actions Kebab Menu

**Goal:** Small menu on every code artifact: annotate / bookmark / deprecate / show impact / copy import path.

**Why this first:**
- Surfaces existing MCP capabilities (`deprecate_artifact`, `/api/pseudo/impact`) that today require Claude gymnastics
- Pure UI work, no backend changes needed
- Low risk, low effort, high discoverability

**Tasks:**
1. Create `ui/src/components/editors/CodeArtifactKebabMenu.tsx` — dropdown with action items
2. Wire actions:
   - **Deprecate** → `api.setDeprecated()` (already exists)
   - **Copy import path** → clipboard write
   - **Show impact** → calls `/api/pseudo/impact` (if pseudo index exists for the file) and shows results in a popover
   - **Unlink** → removes the snippet (existing delete path)
3. Add to the CodeEditor toolbar, right-aligned

**Files touched:**
- `ui/src/components/editors/CodeEditor.tsx`
- `ui/src/components/editors/CodeArtifactKebabMenu.tsx` (new)

**Validation:**
- All actions work end-to-end
- Works in light and dark mode
- Menu closes on outside click and Escape

### 1.3 Open Pseudo Side-by-Side

**Goal:** Toolbar button in CodeEditor that opens the corresponding `.pseudo` file in a side-by-side viewer.

**Why this first:**
- Pure component composition — `PseudoViewer.tsx` already exists
- Pair-view (pseudo summary + actual code) is a killer reading experience
- No schema changes, no new endpoints

**Tasks:**
1. Add a split-pane layout capability to the CodeEditor panel (or use existing SplitPane wrapper)
2. Add a "Show Pseudo" toggle button to the CodeEditor toolbar
3. When toggled on, render `PseudoViewer` for the pseudo file matching the linked source path
4. Handle the "no pseudo file exists" case with a friendly empty state + "Create pseudo" button that invokes `/pseudocode` skill

**Files touched:**
- `ui/src/components/editors/CodeEditor.tsx`
- Possibly a new `ui/src/components/editors/CodeWithPseudoView.tsx` wrapper

**Validation:**
- Open a linked TS file that has a pseudo → pseudo shows on the right
- Open one without a pseudo → friendly empty state
- Toggle off → returns to full-width code editor

### Phase 1 Deliverable

Three independent, deployable features. Commit each one separately. No blockers for the next phase.

---

## Phase 2: Claude MCP Edit Artifact Tool (Core Workflow)

**Dependencies:** Phase 1.1 (Diff Against Disk) for the review surface.

**Goal:** An MCP tool that lets Claude propose edits to a specific code artifact. The UI shows the proposed change as a diff with Accept / Reject buttons, feeding into the existing dirty/push flow.

**Why this matters:** This is the workflow the Code Artifact feature was built for — letting Claude drive edits through the UI with human review. Without this, linked code files are mostly a viewer.

### 2.1 MCP Tool Definition

**Tool:** `propose_code_edit`

**Schema:**
```typescript
{
  project: string,
  session: string,
  todoId?: number,
  id: string,         // snippet ID of the linked code artifact
  newCode: string,    // the proposed full-file content
  message?: string,   // human-readable explanation of the change
}
```

**Behavior:**
1. Validate the snippet exists and has `linked: true` in its envelope
2. Store the proposed change as a new field on the snippet envelope: `proposedEdit: { newCode, message, proposedAt }`
3. Save the updated envelope via `saveSnippet`
4. Broadcast `snippet_updated` WebSocket event so the UI reacts immediately
5. Return `{ success: true, snippetId, hasProposedEdit: true }`

### 2.2 Backend Support

**Files touched:**
- `src/mcp/tools/code.ts` — add `proposeCodeEditSchema` + `handleProposeCodeEdit` handler
- `src/mcp/setup.ts` — register the tool
- `src/routes/api.ts` — optional new endpoint `POST /api/code/proposed-edit/:id/accept` and `/reject` (or handle in the snippet update flow)

**Snippet envelope extension:**
```json
{
  ...,
  "linked": true,
  "proposedEdit": {
    "newCode": "...",
    "message": "Rename foo to bar for clarity",
    "proposedAt": 1775700000000,
    "proposedBy": "claude"
  }
}
```

### 2.3 UI Review Flow

**Files touched:**
- `ui/src/components/editors/CodeEditor.tsx` — detect `proposedEdit` in envelope
- `ui/src/components/editors/ProposedEditReview.tsx` (new) — banner component showing proposal message + Accept/Reject buttons, with embedded diff view (reuses Phase 1.1's `DiffAgainstDiskView` pattern)

**Flow:**
1. Claude calls `propose_code_edit` via MCP
2. Snippet envelope now has `proposedEdit` field
3. WebSocket broadcast triggers UI refresh
4. CodeEditor detects `proposedEdit`, renders the ProposedEditReview banner at the top
5. Banner shows: "Claude proposed: [message]" + diff view (current code vs newCode) + Accept / Reject
6. **Accept** → set `envelope.code = newCode`, remove `proposedEdit`, mark dirty, save. User can then review further and Push to disk.
7. **Reject** → remove `proposedEdit`, leave code unchanged

### 2.4 Validation

- Claude can call the MCP tool successfully
- UI shows the proposal immediately (via WebSocket)
- Accept updates the editor and marks dirty
- Reject removes the proposal without side effects
- Multiple proposals on the same file are handled (the new one replaces the old, or we reject the new one if one is pending)
- The Diff Against Disk feature still works alongside a pending proposal

### Phase 2 Deliverable

Claude-driven editing workflow. This alone justifies the Code Artifact feature's existence.

---

## Phase 3: Pseudo-DB Overhaul ⚠️ THE ENABLER

**Dependencies:** None (can run in parallel with Phase 1 and 2)

**Goal:** Extend pseudo-db schema, fix real bugs, overhaul the parser, update the skill, and add the `/api/pseudo/source-link` endpoint. This unlocks all navigation features in Phases 4 and 5.

**Why this is a focused single effort:** The schema, parser, skill, and tests are tightly coupled. Doing it in one coherent PR is safer than incremental migrations. The SQLite DB is gitignored so there's no cross-user migration concern.

### 3.1 Schema Migration

**Tasks:**
1. Add `schema_version` table
2. Extend `files` table:
   - `source_file_path TEXT`
   - `source_mtime TEXT`
   - `source_hash TEXT`
   - `language TEXT`
   - `indexed_at TEXT DEFAULT (datetime('now'))`
   - `line_count INTEGER`
   - Drop/rename `updated_at`
3. Extend `methods` table:
   - `source_line INTEGER`
   - `source_line_end INTEGER`
   - `visibility TEXT`
   - `is_async INTEGER`
   - `kind TEXT`
   - `param_count INTEGER`
   - `step_count INTEGER`
   - `owning_symbol TEXT`
   - Drop `UNIQUE(file_id, name)` constraint (blocks overloads)
4. Extend `method_calls` table:
   - `callee_method_id INTEGER NULL REFERENCES methods(id) ON DELETE SET NULL`
5. Add missing index: `CREATE INDEX idx_method_calls_stem ON method_calls(callee_file_stem, callee_name)`
6. Widen `pseudo_fts` to include `title`, `purpose`, `module_context`, `params`
7. On startup, if `schema_version < target`, drop tables + recreate + full re-ingest

**Files touched:**
- `src/services/pseudo-db.ts`

**Validation:**
- Startup migration runs cleanly from an existing v0 DB
- Schema version is tracked correctly
- FTS rebuild works

### 3.2 Parser Overhaul

**Tasks:**
1. **Replace the FUNCTION header regex with a line tokeniser.** This is the single most important parser change — the current regex can't handle nested parens and every marker addition cracks it further.
2. Add header parsing for `// source:` and `// language:`
3. Add metadata line parsing — `VISIBILITY:`, `ASYNC:`, `KIND:`, `DEPRECATED:`, `THROWS:`, `DOC:`, `TAGS:`, `TEST:` (only as metadata before the first step; rest are ignored as before)
4. Compute derived fields in the parser: `param_count`, `step_count`, `owning_symbol`
5. Add per-language source file scanning for line number discovery:
   - TypeScript → regex for `function foo`, `const foo =`, `foo:`, `async foo`, class methods
   - C# → regex for `(public|private|internal|protected|static)*\s*<return-type>\s+<method-name>\s*\(`
   - C++ → best-effort regex with header handling
   - Python → `def foo` and `async def foo`
   - Fall back to null if extraction fails (good-effort, not 100%)
6. Populate `source_mtime`, `source_hash`, `line_count` from `fs.statSync` + file read at ingest time
7. Second-pass resolution of `method_calls.callee_method_id` after all files are ingested

**Files touched:**
- `src/services/pseudo-parser.ts`
- `src/services/pseudo-db.ts` — update `upsertFile` / `bulkIngest` to set new fields

**Validation:**
- Parser round-trips existing `.pseudo` files without data loss
- New markers are recognized and stored correctly
- Language-specific line extraction works for at least TS and C# on sample files
- Overloaded methods (C#/TS) no longer cause DB errors

### 3.3 Skill Updates

**Tasks:**
1. Update `skills/pseudocode/SKILL.md`:
   - Add Step 2b for file-level headers (`// source:`, `// language:`)
   - Update Step 3 example to show function metadata markers
   - Add "Function Metadata Markers" subsection with full marker list
   - Update "If pseudo file exists — Update" flow to check visibility/async/throws changes
   - Add language-specific conventions table (TS, C#, C++, Python)
2. Update `skills/pseudocode/PSEUDOCODE_SPEC.md`:
   - Add "File-Level Metadata (Optional)" section
   - Add "Function-Level Metadata (Optional)" section with full marker list and examples
3. Fix inconsistency between project-root `PSEUDOCODE_SPEC.md` and skill-directory copy — project-root version should include `// synced:` in the example.

**Files touched:**
- `skills/pseudocode/SKILL.md`
- `skills/pseudocode/PSEUDOCODE_SPEC.md`
- `PSEUDOCODE_SPEC.md` (project root — consistency fix)

**Validation:**
- `/pseudocode` command produces files with new markers when relevant
- Claude correctly adds VISIBILITY / ASYNC / THROWS markers when regenerating a file
- Language-specific rules are followed (e.g., Python leading-`_` → private)

### 3.4 Bug Fixes (bundled)

**Must fix while we're in there:**
1. **`getCoverage()`** — currently returns 100% always. Rewrite using new `source_file_path` + `source_mtime` columns and a source tree walk. Or delete the endpoint + MCP tool if coverage isn't worth implementing properly.
2. **`getStats` N+1** — replace JS summation with three COUNT queries
3. **`getFile` N+1** — collapse to two queries using `json_group_array`
4. **Stem-collision bug in `getCallGraph`** — fixed by populating `callee_method_id` (use id joins, not stem joins)
5. **`getImpactAnalysis` recursive CTE** — simplify now that edges are id-based
6. **FTS delete dance in `bulkIngest`** — replace with `DROP VIRTUAL TABLE pseudo_fts; CREATE...` inside the transaction
7. **`getExports().purpose` mislabeled field** — rename to `stepSummary` or drop
8. **Missing index** on `method_calls.callee_file_stem` — already covered in schema migration

**Files touched:**
- `src/services/pseudo-db.ts`
- `src/routes/pseudo-api.ts`
- `src/mcp/tools/` — update any pseudo MCP tools affected by renames

**Validation:**
- All endpoints return sensible data
- Query performance improved on large projects (measure before/after)
- Coverage endpoint works or is cleanly removed

### 3.5 New `/api/pseudo/source-link` Endpoint

**Goal:** Given a method name + optional file stem hint, return `{ source_file_path, source_line, source_line_end, language }` for editor deep-linking. This is the headline win for navigation features.

**Schema:**
```
GET /api/pseudo/source-link?project=...&name=bar&hintFileStem=utils
→ {
    candidates: [
      { sourceFilePath: "src/utils.ts", sourceLine: 42, sourceLineEnd: 58, language: "typescript", isExported: true }
    ]
  }
```

**Files touched:**
- `src/routes/pseudo-api.ts`
- `ui/src/lib/pseudo-api.ts` — client method

**Validation:**
- Single-match lookup returns one candidate
- Multi-match lookup (overloaded methods) returns multiple
- Unknown method returns empty candidates
- Hint stem correctly scopes the search

### Phase 3 Deliverable

A pseudo-db that's faster, less buggy, and knows where functions live in source code. The skill produces richer metadata. The `/api/pseudo/source-link` endpoint is ready to power navigation features.

**Testing strategy:**
- Reindex the mermaid-collab project itself (eat our own dog food)
- Verify all MUST-HAVE columns populate correctly for TS files
- Spot-check C# support if any C# files exist in the test corpus (or synthesize one)
- Compare query counts / timings before and after for `getFile` and `getStats`
- Confirm existing `.pseudo` files without markers still parse

---

## Phase 4: Navigation Features (Unlocked by Phase 3)

**Dependencies:** Phase 3 complete (source-link endpoint + line numbers in pseudo-db)

### 4.1 Feature A: Function Jump Dropdown

**Goal:** Searchable dropdown in the CodeEditor toolbar listing all functions in the current file. Click to scroll the editor to that function.

**Two-tier strategy:**
- **Tier 1 (primary):** Query pseudo-db via new `GET /api/pseudo/functions-for-source?sourcePath=...` endpoint — returns `[{ name, params, isExported, sourceLine, visibility, kind }, ...]`
- **Tier 2 (fallback):** When pseudo index is missing, walk the CodeMirror Lezer syntax tree for TS/JS files. Python/C#/C++ fall through to Tier 1 or degrade gracefully.

**Tasks:**
1. Add new endpoint `GET /api/pseudo/functions-for-source` in `src/routes/pseudo-api.ts`
2. Create `ui/src/lib/extract-functions.ts` — Tier 2 Lezer walker for TS/JS (reusable by Feature B)
3. Create `ui/src/components/editors/FunctionJumpDropdown.tsx` — searchable combobox
4. Add `jumpToLine(line)` helper to `CodeMirrorWrapper.tsx` (exposed via ref/imperative handle)
5. Wire the dropdown into CodeEditor's toolbar via `onToolbarControls`
6. Refresh the function list on sync, push, and content change (debounced 200ms)

**Files touched:**
- `src/routes/pseudo-api.ts`
- `ui/src/lib/pseudo-api.ts`
- `ui/src/lib/extract-functions.ts` (new)
- `ui/src/components/editors/CodeMirrorWrapper.tsx`
- `ui/src/components/editors/CodeEditor.tsx`
- `ui/src/components/editors/FunctionJumpDropdown.tsx` (new)

**Validation:**
- Open a linked TS file with a pseudo index → dropdown populated from Tier 1, clicks jump correctly
- Open one without pseudo → Tier 2 fallback populates the dropdown
- Searchable filter works for long function lists
- Refreshes after Sync brings new content from disk

### 4.2 Show References (Who Calls This Function)

**Dependencies:** Feature A's `extract-functions.ts` (for identifying the clicked symbol) + Phase 3's `callee_method_id` FK (for precise reference tracking).

**Goal:** Select a function name in the CodeEditor → popover lists all callers, click-to-navigate.

**Tasks:**
1. Add click-on-identifier detection in `CodeMirrorWrapper` (reuses the Feature A Lezer walker to identify the symbol at cursor)
2. Wire a `onSymbolClick` callback in CodeEditor
3. On click, call existing `fetchPseudoReferences(name)` endpoint (already exists)
4. Show results in a popover (reuse existing `CallsPopover.tsx` pattern)
5. Each result is clickable → navigates via the same mechanism as Feature B

**Files touched:**
- `ui/src/components/editors/CodeMirrorWrapper.tsx`
- `ui/src/components/editors/CodeEditor.tsx`
- `ui/src/components/editors/ReferencesPopover.tsx` (new, or reuse `CallsPopover`)

**Validation:**
- Click a function name → popover shows callers with file + line hints
- Click a caller → navigates (integrates with Feature B once available, or opens a read-only preview beforehand)
- Popover dismisses on click-outside and Escape

### Phase 4 Deliverable

Users can navigate within a file (function dropdown) and see reference relationships. The symbol extractor and line-jump primitive are now reusable infrastructure.

---

## Phase 5: Advanced Navigation + Search

### 5.1 Feature B: Cross-File Navigation

**Dependencies:** Feature A (shared symbol extractor), Phase 3 (source-link endpoint).

**Goal:** Explicit "Go to definition" action (right-click or keyboard shortcut) that navigates to a function's definition across files. If the target file isn't linked, offer to link it.

**Reframed UX (per brainstorm):** Not silent auto-link. Explicit action with confirmation when linking new files.

**Tasks:**
1. Add right-click context menu or cmd-click handler in CodeEditor
2. Identify clicked symbol via Feature A's extractor
3. Call `/api/pseudo/source-link?name=...&hintFileStem=...` (or a new `/api/code/find-definition` wrapper that also supports a grep fallback)
4. If multiple candidates → show picker popover
5. Check session for existing linked snippet with `filePath === candidate.sourceFilePath`
6. If not linked → confirm dialog "Link `src/utils.ts` and navigate to `hashPassword` at line 42?"
7. On confirm, call existing `link_code_file` flow + focus the new snippet's editor + scroll to line
8. Add a nav-history stack for back-navigation

**Files touched:**
- `ui/src/components/editors/CodeMirrorWrapper.tsx` — click detection
- `ui/src/components/editors/CodeEditor.tsx` — plumb handler
- `ui/src/lib/symbol-nav.ts` (new) — resolver + link-or-focus orchestration
- `ui/src/components/editors/DefinitionPickerPopover.tsx` (new) — when multiple candidates
- `src/routes/code-api.ts` — optional `/api/code/find-definition` wrapper with grep fallback

**Validation:**
- Right-click on a function call → "Go to definition" menu
- Definition in the same file → scrolls to line
- Definition in another linked file → focuses that editor + scrolls
- Definition in unlinked file → confirm dialog → on confirm, file is linked and opened
- Multiple candidates → picker shows, click one to proceed
- Back-navigation works

### 5.2 Cross-Artifact Code Search (Independent, lower priority)

**Dependencies:** None strictly, but Phase 3's widened FTS makes it far more useful.

**Goal:** Top-level search box that queries both pseudo FTS and linked code content in one unified result list.

**Tasks:**
1. Add `POST /api/code/search?project=...&session=...` endpoint — fans out to pseudo FTS search + linked-snippet content grep
2. Create `ui/src/components/layout/GlobalSearch.tsx` — search overlay (Cmd+K)
3. Unified result list showing file path, match context, click-to-navigate
4. Integrate with Feature B's navigation for click-to-jump

**Files touched:**
- `src/routes/code-api.ts` or new `src/routes/search-api.ts`
- `ui/src/components/layout/GlobalSearch.tsx` (new)
- `ui/src/components/layout/Sidebar.tsx` — add the search trigger

**Validation:**
- Search finds matches in both pseudo files and linked code
- Clicking a result navigates correctly (using Feature B's machinery)

### Phase 5 Deliverable

The full navigation story. Users can browse their codebase from inside the collab session.

---

## Risk Assessment

### Phase 1 Risks: Low
- All three features are UI-only composition work with existing APIs
- `@codemirror/merge` is a well-established package
- No schema changes

### Phase 2 Risks: Low-Medium
- Adds a new field to the snippet envelope → backward compatibility handled by optional field
- Requires WebSocket event handling in the UI → standard pattern
- Claude integration is MCP tool addition → standard pattern

### Phase 3 Risks: Medium ⚠️
- **Pseudo-db migration** — SQLite file is gitignored so users re-index, but the re-ingest must be correct
- **Parser regex → tokeniser** — replacing working code with new code always risks regressions. Mitigation: keep tests for all existing `.pseudo` files in the repo.
- **Language-specific line extraction** — C# and C++ are "good-effort" per user decision. Acceptable risk.
- **Skill updates** — the skill is user-invoked; errors surface immediately when someone runs `/pseudocode`
- **Bug fixes** — some bug fixes (N+1 rewrites) touch query shape; verify end-to-end

**Mitigation strategies:**
- Comprehensive test suite for the parser before refactoring
- Feature flag / env var to fall back to old parser if new one crashes
- Run the new parser over the full mermaid-collab codebase and diff the resulting DB state before shipping
- Phase 3 gets its own blueprint + task graph + review cycle

### Phase 4 Risks: Low-Medium
- Dependent on Phase 3's correctness, especially `source-link` endpoint
- Feature A's Tier 2 Lezer fallback needs testing for JS/TS edge cases
- Click detection in CodeMirror must not interfere with normal editing

### Phase 5 Risks: Medium
- Feature B's "link new file on click" has UX pitfalls — must get the confirmation flow right
- File-outside-project edge cases must be handled (e.g., clicking a `node_modules` import)
- Multiple definitions must show a picker, not silently pick wrong one

---

## Recommended Execution Order

### Sprint 1 (1-2 PRs): Phase 1 features in parallel
- PR #1: Diff Against Disk
- PR #2: Kebab Menu
- PR #3: Open Pseudo Side-by-Side

These are independent. Pick whichever maintainer wants to do first.

### Sprint 2: Phase 2
- PR #4: Claude MCP Edit Artifact Tool (builds on PR #1)

### Sprint 3: Phase 3 (the big one)
Can be a single large PR or split along the natural seams:
- PR #5: Schema migration + bug fixes (no parser/skill changes yet)
- PR #6: Parser overhaul (regex → tokeniser, metadata markers, source scan)
- PR #7: Skill updates (SKILL.md + spec updates)
- PR #8: New `/api/pseudo/source-link` endpoint

Or one single Phase 3 PR if the team prefers atomic changes. The internal dependencies are tight.

### Sprint 4: Phase 4
- PR #9: Feature A (Function Jump Dropdown) + shared `extract-functions.ts` lib
- PR #10: Show References

### Sprint 5: Phase 5
- PR #11: Feature B (Cross-File Navigation)
- PR #12: Cross-Artifact Code Search (optional, can defer)

---

## Testing Strategy

### Per-Phase Validation Gates

**Phase 1:**
- Manual test each feature in the collab UI
- Verify no regression to existing linked-file behavior
- Dark mode + light mode parity

**Phase 2:**
- Claude can propose edits via MCP and the UI reacts immediately
- Accept + Reject flows round-trip correctly
- Existing linked-file flow unaffected when no proposal is pending

**Phase 3 (most thorough):**
- Snapshot the current pseudo-db state before migration
- Run full re-index; verify all columns populate as expected
- Test overloaded methods (create a C# file with overloads; verify both appear)
- Test missing `// source:` header (should fall back to derivation)
- Test the source-link endpoint end-to-end
- Verify all existing pseudo API endpoints still return the same shape (or updated shape if field renames happened)
- Run the `/pseudocode` skill on a real file and verify new markers are added when appropriate

**Phase 4:**
- Test function jump on TS, C#, and Python files (via pseudo-db)
- Test Lezer fallback on TS files that have no pseudo index
- Verify "show references" works for functions with multiple callers

**Phase 5:**
- Test cross-file navigation with all combinations: same-file, other-linked-file, unlinked-file, multiple candidates, unknown function
- Test back-navigation history
- Test file-outside-project guard
- Test search against both pseudo and source content

### Regression Guard

Before each phase, run the current test suite. Phase 3's parser changes especially need strong test coverage — add snapshot tests for parsed pseudo file outputs if they don't exist yet.

---

## Out of Scope (per brainstorm decisions)

- LSP integration (overkill, pseudo-db + grep fallback is enough)
- Silent auto-link on click in Feature B (must be explicit)
- 100% accurate C++ parsing (good-effort is fine)
- Full symbol indexer / background indexer (CodeMirror Lezer is fast enough on-demand)
- Multi-language Tier 2 parsing beyond TS/JS initially
- `method_params` structured table (parser needs real type tokeniser first — defer)
- Vector embeddings / semantic search (FTS5 is sufficient)
- Git blame integration
- Test runner integration

---

## Success Criteria

The overall migration succeeds when:

1. Users can edit linked code files and see a clear diff before pushing to disk (Phase 1)
2. Claude can propose edits that appear in the UI for human review (Phase 2)
3. Pseudo-db correctly indexes function line numbers for TS and C# files, with bugs fixed (Phase 3)
4. Users can jump to functions within a file via dropdown (Phase 4)
5. Users can right-click a function call and navigate to its definition, linking files as needed (Phase 5)

At that point, the Code Artifact feature is a real bridge between collab sessions and the codebase — enabling Claude-driven edits, cross-file navigation, and in-session code understanding.

---

## Source Artifacts

- `feature-brainstorm` — feature ideas, priorities, UX decisions
- `pseudo-db-audit` — schema analysis, bugs, skill updates, proposed changes
- `code-artifact-design` — the original design doc for the feature
- `bp-code-artifact` — the completed blueprint for the initial implementation