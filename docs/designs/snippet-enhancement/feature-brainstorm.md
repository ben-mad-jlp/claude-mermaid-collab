# Code Artifact — Feature Brainstorm

Planning doc evaluating two user-proposed features and suggesting additional ones.

## User Decisions (2026-04-09 update)

1. **pseudo-db is our code** — we can extend it. Adding line numbers as columns is on the table.
2. **Primary languages: C# and TypeScript.** C# support is required if doable. C++ is used a good bit and should be a close second.
3. **Good-effort navigation is fine** — doesn't need to be 100% accurate at finding linked function code.
4. **Diff against disk** → confirmed priority
5. **Show references** → confirmed priority
6. **Cross-artifact code search** → interesting, worth exploring
7. **Claude MCP edit artifact tool** → upgraded to important
8. **Quick-actions kebab menu** → confirmed

---

## Prerequisite: Extend pseudo-db with Source Line Numbers

Since pseudo-db is our code, the cleanest unlock for Features A and B is to add line number tracking directly to the pseudo-db schema.

### Proposed Schema Changes

Add to `src/services/pseudo-db.ts`:
- `methods` table → add column `source_line INTEGER` — the starting line of the method in the actual source file (not the .pseudo file)
- `methods` table → optionally add `source_line_end INTEGER` for method span
- `pseudo_files` table → add column `source_file_path TEXT` — the absolute or project-relative source file path that this pseudo file describes (removes the stem-based guessing)

### How Lines Get Populated

The pseudo parser (`src/services/pseudo-parser.ts`) currently reads `.pseudo` files. We extend it so that when indexing a pseudo file, it also reads the corresponding source file and runs a lightweight per-language function locator:

- **TypeScript/JavaScript**: regex or CodeMirror Lezer-based walk (CodeMirror parsers also work server-side)
- **C#**: regex matching on `(public|private|internal|protected|static)*\s*<return-type>\s+<method-name>\s*\(` — good-effort, not perfect
- **C++**: similar regex with header handling — definitely good-effort, perfect parsing is hard
- Match method names from the `methods` table to lines in the source file, store the first match as `source_line`

Language support order: **TypeScript → C# → C++ → Python → others**

Good-effort ≠ perfect. If we find 80% of methods correctly, that's acceptable. Users can still scroll to navigate the remaining 20%.

### Result

Once this lands, every feature that wants to "jump to function in source" becomes trivial: one SQL query gets you `(filePath, line)`. This unblocks the elegant implementations of Features A and B described below.

---

## Part 1: Feature A — Function Jump Dropdown

**Reasonable?** Yes. **Complexity:** Low-to-Medium.

A dropdown listing functions in the currently open code file, clickable to scroll editor to that function.

### Data Source — Two-Tier Strategy

**Tier 1: pseudo-db with line numbers (primary)** ⭐ after prerequisite lands
- Query pseudo-db for the file: get all methods with `(name, params, isExported, source_line)`
- Fast, consistent with Show References and Cross-File Nav
- ✅ Works for any language pseudo-db supports (TS, C#, C++, ...)
- ❌ Requires pseudo index for the file; dropdown is empty for unindexed files

**Tier 2: CodeMirror Lezer live parse (fallback)**
- When pseudo index is missing, walk the CodeMirror syntax tree for functions
- ✅ Always accurate, live-syncs as user edits
- ❌ Language coverage limited to what CodeMirror has Lezer parsers for (JS/TS strong, others weaker)

**Recommendation:** Ship Tier 1 first (once pseudo-db line numbers land). Tier 2 as a fallback for files without a `.pseudo` sibling.

### UX

Searchable dropdown in CodeEditor toolbar (user preference). Items show:
- Function name
- Params summary (short form)
- Line number
- Export badge if `isExported`

### Implementation Sketch

Files to touch:
1. `ui/src/components/editors/CodeEditor.tsx` — add `functionsControl` to `mergedControls`
2. `ui/src/components/editors/CodeMirrorWrapper.tsx` — expose `jumpToLine(line)` method via ref/callback
3. **NEW** `ui/src/components/editors/FunctionJumpDropdown.tsx` — searchable combobox
4. **NEW** endpoint `GET /api/pseudo/functions-for-source?project=...&sourcePath=...` — returns methods for a source file (joined via pseudo-db's `source_file_path`)
5. **NEW** `ui/src/lib/extract-functions.ts` — Tier 2 Lezer fallback (TS/JS only initially)

Jump primitive: `view.dispatch({ selection: { anchor: linePos }, effects: EditorView.scrollIntoView(linePos, { y: "start" }) })`

### Gotchas

- **Language coverage in pseudo-db line extraction**: TS is easy, C# is regex-doable, C++ is messy but good-effort is fine
- **Arrow/anonymous functions**: `const foo = () => {}` should still surface — handle in the per-language source-line extractor
- **Methods vs functions**: include class methods with qualified names like `Foo.bar`
- **Refresh after sync**: when user clicks Sync and disk content changes, refetch function list
- **Dropdown clipping**: use portal pattern like `CallsPopover`

---

## Part 2: Feature B — Cross-File Navigation

**Reasonable?** Yes, dramatically more so once pseudo-db has line numbers. **Complexity:** Medium.

Click a function call in the code; if definition is in another file, optionally link that file and navigate to the definition.

### What pseudo-db Gives Us

- `method_calls` table already tracks `(caller_method_id, callee_name, callee_file_stem)`
- After prerequisite: `methods` table has `source_line` → resolver returns `(filePath, line)` in one query
- `pseudo_files.source_file_path` → no more stem-based guessing

**Key insight:** With line numbers in pseudo-db, Feature B's resolver becomes a single SQL join. No grep, no runtime parsing, no LSP.

### Resolution Flow (new, elegant version)

1. User clicks identifier in CodeEditor (explicit cmd-click or right-click → "Go to definition")
2. Client sends `GET /api/code/find-definition?project=...&symbol=...&hintFileStem=...`
3. Backend queries pseudo-db: find methods matching name, optionally scoped by file stem if provided
4. Return candidates: `[{ filePath, line, language, isExported }, ...]`
5. If one result: proceed. If multiple: show picker popover.
6. Check session for existing linked snippet with `filePath === target`
7. If not linked: confirm dialog "Link `src/utils.ts` to navigate?" → link via existing `link_code_file` flow
8. Focus the target snippet's editor, scroll to line

### Resolution Fallbacks (when pseudo-db misses)

Good-effort tier:
- **Grep fallback**: `rg "(function|def|public|private|void)\s+bar\b"` across project — works even for unindexed files
- **Nothing found**: show a toast "Definition not found for `bar`" and do nothing else (no silent failures)

### UX: Reframed from "Automatic" to "Explicit"

**Not:** Silent auto-link on every click (dangerous — accidental file explosion).
**Instead:** Explicit "Go to definition" action via:
- Right-click context menu → "Go to definition"
- Keyboard shortcut (cmd-click or F12)
- Only asks to link if target file isn't already in the session

Users control when new artifacts get created. Back-navigation via small breadcrumb/history stack.

### Implementation Sketch

1. `CodeMirrorWrapper.tsx` — add click-on-identifier detection (CodeMirror `domEventHandlers`, `syntaxTree().resolveInner` to get token under cursor)
2. `CodeEditor.tsx` — plumb `onSymbolClick(symbolName, context)` callback
3. **NEW** `ui/src/lib/symbol-nav.ts` — resolver orchestrating pseudo-db query + grep fallback + link-code
4. **NEW** `GET /api/code/find-definition?project=...&symbol=...&hintFileStem=...` — returns `[{ filePath, line, language, isExported }]`
5. Small nav-history stack for back-navigation
6. `src/routes/api.ts` — ensure `linkCode` is idempotent (checks for existing link before creating)

### Gotchas

- **Multiple definitions**: interface + class with same name, or overloads. Return candidates, show picker.
- **Uncached files**: pseudo index missing → grep fallback. Clearly mark results as "approximate."
- **External deps**: clicking `useState` should NOT link `node_modules/react/...`. Gate on "within project root, not gitignored."
- **Linking explosion**: per user decision, an explicit confirm avoids this.
- **C# namespace resolution**: `using System.Text` + `StringBuilder.Append` — good-effort is fine; if we can't find it, show "not found" toast.
- **C++ header vs implementation**: function declared in `.h`, defined in `.cpp`. Prefer definition (body) when both exist.
- **Performance**: parse on click, never on mouseover.

### Relationship to Feature A

Significant shared code:
- **Line-jump primitive** `jumpToLine(view, line)` — identical
- **`/api/pseudo/functions-for-source`** could also answer "find by name" if we add a name param
- Both depend on the pseudo-db line number extension

**Build Feature A first** — it proves out the line-number extraction pipeline before the more complex navigation flow uses it.

---

## Part 3: Additional Feature Suggestions

### 1. Diff Against Disk ⭐ CONFIRMED
**What:** Show unified diff between in-editor buffer and current on-disk version before Push.
**Why:** The `dirty` flag is tracked; Push/Sync exist. A diff preview prevents the "overwrote my file" fear.
**Complexity:** Low-Medium. Use `@codemirror/merge`.
**Dependencies:** None.

### 2. Show References (Who Calls This Function) ⭐ CONFIRMED
**What:** Select a function name → popover lists all callers via `fetchPseudoReferences`, click-to-navigate.
**Why:** Pseudo-db already supports this; UI pattern exists in `CallsLink.tsx` + `CallsPopover.tsx`. With line numbers added, clicks jump precisely.
**Complexity:** Low.
**Dependencies:** Feature A's symbol-extraction + pseudo-db line numbers.

### 3. Open Pseudo Side-by-Side
**What:** Toolbar button in CodeEditor opens corresponding `.pseudo` file in side-by-side viewer (reuse `PseudoViewer.tsx`).
**Why:** Pseudo is often the best summary of a code file. Pair-view reading is a killer combo.
**Complexity:** Low-Medium. Mostly layout.
**Dependencies:** Layout slot in CodeEditor host.

### 4. Cross-Artifact Code Search ⭐ CONFIRMED (interesting)
**What:** Top-level search box querying `/api/pseudo/search` (FTS) AND plain-text over currently linked code snippets. Unified results with snippet preview.
**Why:** Linked code files currently have no cross-file search. Pseudo FTS is already there; we just need to layer a code-content search on top.
**Complexity:** Medium. Pseudo half trivial; source half needs a small `/api/code/search` endpoint (ripgrep-backed) or client-side fan-out.
**Dependencies:** Possibly `/api/code/search` endpoint.

### 5. Claude MCP: Edit Artifact Tool ⭐ UPGRADED TO IMPORTANT
**What:** MCP tool letting Claude propose edits to a specific code artifact. Shows diff in CodeEditor with Accept/Reject buttons, feeding into existing dirty/push flow.
**Why:** Code artifacts are meant to bridge collab sessions and codebase. Letting Claude drive edits with human review is exactly that bridge. This is the core workflow the feature was built for.
**Complexity:** Medium. Tool definition + diff-review UI affordance.
**Dependencies:** Feature #1 (diff viewer) for review surface.

**Proposed MCP tool shape:**
```
propose_code_edit(project, session, snippetId, newCode, message?)
  → creates a "proposed edit" state on the snippet
  → UI shows diff between current code and proposed code
  → user clicks Accept (applies) or Reject (discards)
  → broadcasts via WebSocket so collab users see the proposal
```

### 6. Quick-Actions Kebab Menu ⭐ CONFIRMED
**What:** Small menu on every code artifact: annotate / bookmark / deprecate / show impact / copy import path.
**Why:** Surfaces existing MCP capabilities (`deprecate_artifact`, `/api/pseudo/impact`) that today require Claude gymnastics to invoke.
**Complexity:** Low.
**Dependencies:** None.

---

## Part 4: Revised Prioritization

Based on user decisions, this is the updated ranking:

| Rank | Feature | Value | Effort | Blocked By |
|------|---------|-------|--------|------------|
| 0 | **pseudo-db line number extension** | Enabler | Medium | — |
| 1 | **Diff Against Disk** (#1) | High | Low ⭐ | — |
| 2 | **Claude MCP Edit Artifact Tool** (#5) | High | Medium | #1 |
| 3 | **Feature A: Function Jump Dropdown** | Med-High | Low-Med | pseudo-db line numbers |
| 4 | **Show References** (#2) | Med-High | Low | Feature A + pseudo-db line numbers |
| 5 | **Quick-Actions Kebab Menu** (#6) | Med | Low | — |
| 6 | **Open Pseudo Side-by-Side** (#3) | Med-High | Low | — |
| 7 | **Feature B: Cross-File Navigation** | High | Medium | Feature A |
| 8 | **Cross-Artifact Code Search** (#4) | Med | Medium | — |

### Recommended Build Order

**Phase 1 — Immediate wins (no dependencies):**
- Diff Against Disk
- Quick-Actions Kebab Menu
- Open Pseudo Side-by-Side

**Phase 2 — Core workflow:**
- Claude MCP Edit Artifact Tool (builds on Phase 1's diff)

**Phase 3 — The pseudo-db extension (unlocks navigation features):**
- Add `source_line`, `source_line_end`, `source_file_path` columns
- Build the per-language source-line extractor (TS → C# → C++)
- Backfill existing pseudo files with line numbers

**Phase 4 — Navigation features:**
- Feature A: Function Jump Dropdown
- Show References

**Phase 5 — Advanced navigation:**
- Feature B: Cross-File Navigation (with explicit "Go to definition" UX)
- Cross-Artifact Code Search

### What to Build First

Start with **Phase 1 + Phase 2** (Diff, Kebab Menu, Pseudo Side-by-Side, MCP Edit Tool). These are all independent, low-risk, and immediately useful. They also deliver the Claude-driven editing workflow that was the original motivation for the feature.

Then commit to **Phase 3 (pseudo-db line number extension)** as a single focused piece of work. It's a prerequisite for the navigation features and should be treated as its own mini-project with solid testing per language.

Feature B stays in Phase 5 as the ambitious end goal but is much more tractable now that we're extending pseudo-db rather than fighting around it.

---

## Updated Over-Engineering Flags

- ✅ **Extending pseudo-db with line numbers is the RIGHT call** (reversing earlier recommendation). We own the code, the languages overlap with what pseudo-db already parses, and it unlocks multiple features cleanly.
- ❌ **Don't build LSP integration** for Feature B. With pseudo-db line numbers, LSP is unnecessary.
- ❌ **Don't aim for 100% parse accuracy.** C++ in particular will have edge cases. Good-effort is explicitly acceptable per user decision.
- ❌ **Don't build a full background symbol indexer.** pseudo-db's existing indexing on pseudo-file change is enough.
- ⚠️ **Reconsider Feature B's "automatic link" framing.** Make it "Go to definition, and if target isn't linked, offer to link" — confirmation, not silent action.
- ⚠️ **Be honest about C++ parse quality.** Ship it with a "Best effort" label; users who need precise C++ navigation can use VS Code.

---

## Language Support Priority (per user)

| Language | Priority | Notes |
|----------|----------|-------|
| TypeScript | 1 | Primary — Lezer parser, regex both work well |
| C# | 2 | Primary — regex-doable, pseudo-db parser already handles it |
| C++ | 3 | Used a good bit — good-effort is fine, don't over-engineer |
| Python | 4 | Opportunistic |
| Others | 5 | Add only if user requests |

---

## Critical Files for Implementation

**Backend (pseudo-db extension):**
- `src/services/pseudo-db.ts` — schema changes, migrations
- `src/services/pseudo-parser.ts` — add source-file line extraction per language
- `src/routes/pseudo-api.ts` — new `/api/pseudo/functions-for-source` endpoint

**Backend (feature endpoints):**
- `src/routes/api.ts` — idempotent `linkCode`, new `/api/code/find-definition`, `/api/code/search`
- **NEW** `src/mcp/tools/code.ts` — `propose_code_edit` MCP tool

**Frontend:**
- `ui/src/components/editors/CodeEditor.tsx` — toolbar additions, diff view, kebab menu
- `ui/src/components/editors/CodeMirrorWrapper.tsx` — jumpToLine, click detection, diff plugin
- `ui/src/components/editors/SnippetEditor.tsx` — minor toolbar tweaks
- **NEW** `ui/src/components/editors/FunctionJumpDropdown.tsx`
- **NEW** `ui/src/components/editors/DiffAgainstDiskView.tsx`
- **NEW** `ui/src/components/editors/ProposedEditReview.tsx`
- **NEW** `ui/src/lib/symbol-nav.ts`
- `ui/src/pages/pseudo/CallsLink.tsx` (pattern reference)
- `ui/src/pages/pseudo/CallsPopover.tsx` (pattern reference)