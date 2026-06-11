# Blueprint: Phase 4 — Navigation Features (Feature A + Show References)

Phase 4 of the snippet-enhancement migration. Delivers two navigation features that the Phase 3 pseudo-db overhaul unlocked:

1. **Feature A — Function Jump Dropdown:** searchable dropdown in the CodeEditor toolbar listing all functions in the current linked file. Click to scroll the editor to that function.
2. **Show References:** click a function name in the CodeEditor → popover lists all callers via the existing `/api/pseudo/references` endpoint. Click-through navigates within the same file (or opens the referenced file if linked; unlinked cross-file navigation is explicitly Phase 5's job).

Both features share an infrastructure layer that Phase 5 will also reuse:
- A `jumpToLine(view, line)` primitive (no code change — dispatch a transaction on the CodeMirror `EditorView` already exposed via `onEditorReady`).
- An `extract-functions.ts` Lezer-based walker for TS/JS that serves as the Tier 2 fallback when the pseudo-db has no index for the file.
- Click-on-symbol detection as a new `onSymbolClick` prop on `CodeMirrorWrapper`.

## Source Artifacts
- `migration-plan` — Phase 4 section (4.1 + 4.2)
- Existing code: CodeMirrorWrapper.tsx (already exposes `onEditorReady(view)`), CallsPopover.tsx (the popover pattern to mirror), pseudo-api.ts client (already has `fetchPseudoReferences`)

## Scope Decisions
- **Tier 1 (pseudo-db) is primary.** Tier 2 Lezer fallback only runs when Tier 1 returns zero results for the current source path.
- **Tier 2 is TS/JS only.** Python, C#, C++ users get Tier 1 or nothing — acceptable per user's earlier good-effort decision.
- **Show References uses existing `/api/pseudo/references` endpoint.** No backend work for Feature B — it already exists and was already callable from the UI client. We wire the UI side only.
- **Click navigation within the same file only in Phase 4.** Popover results that point to OTHER linked files in the session are clickable (focus + scroll). Results that point to UNLINKED files show the path but are not clickable — Phase 5 adds the "offer to link" flow.
- **No new backend tests for Feature B** — the endpoint and DB method are unchanged from Phase 3.

---

## 1. Structure Summary

### 1.1 Files

**Backend**
- [ ] `src/services/pseudo-db.ts` — **modify** — add new method `getFunctionsForSource(sourceFilePath)` returning a list of function metadata for a single source file
- [ ] `src/routes/pseudo-api.ts` — **modify** — add new `GET /api/pseudo/functions-for-source?sourcePath=...` endpoint
- [ ] `src/services/__tests__/pseudo-db.test.ts` — **modify** — add test for `getFunctionsForSource`
- [ ] `src/routes/pseudo-api.test.ts` — **modify** — add test for the new endpoint

**Frontend**
- [ ] `ui/src/lib/pseudo-api.ts` — **modify** — extend `PseudoMethod` interface with Phase 3 fields (visibility, isAsync, kind, sourceLine, sourceLineEnd, paramCount, owningSymbol) as optional; add new `fetchFunctionsForSource(project, sourcePath)` client method + `FunctionForSource` type
- [ ] `ui/src/lib/extract-functions.ts` — **new** — Tier 2 Lezer walker for TS/JS, exports `extractFunctions(code, language)` returning an array matching the same shape as `FunctionForSource`. Also exports `findSymbolAtPos(view, pos)` helper for click-on-symbol detection.
- [ ] `ui/src/lib/__tests__/extract-functions.test.ts` — **new** — unit tests for the Lezer walker and symbol lookup
- [ ] `ui/src/components/editors/CodeMirrorWrapper.tsx` — **modify** — add optional `onSymbolClick?: (symbol: string, rect: DOMRect) => void` prop. When provided, install a ViewPlugin that listens for click events and resolves the identifier at the click position via `findSymbolAtPos`.
- [ ] `ui/src/components/editors/FunctionJumpDropdown.tsx` — **new** — searchable combobox listing functions for the current file, built on top of the data from Tier 1 + Tier 2
- [ ] `ui/src/components/editors/ReferencesPopover.tsx` — **new** — popover showing callers of a clicked function (mirrors CallsPopover.tsx structure + positioning)
- [ ] `ui/src/components/editors/CodeEditor.tsx` — **modify** — wire the dropdown into the toolbar, wire the onSymbolClick handler, render the ReferencesPopover, add jump-to-line helper using the `EditorView` captured via `onEditorReady`

### 1.2 Type Definitions

**Backend (`src/services/pseudo-db.ts`)**

```typescript
// New method return type
export interface FunctionForSource {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  sourceLine: number | null;
  sourceLineEnd: number | null;
  visibility: string | null;
  isAsync: boolean;
  kind: string | null;
}

// New public method on PseudoDbService
getFunctionsForSource(sourceFilePath: string): FunctionForSource[];
```

**Frontend (`ui/src/lib/pseudo-api.ts`)**

```typescript
// Extend existing PseudoMethod with Phase 3 optional fields
export interface PseudoMethod {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  date: string | null;
  steps: Array<{ content: string; depth: number }>;
  calls: Array<{ name: string; fileStem: string }>;
  // NEW — all optional for backward compat
  visibility?: string | null;
  isAsync?: boolean;
  kind?: string | null;
  sourceLine?: number | null;
  sourceLineEnd?: number | null;
  paramCount?: number;
  owningSymbol?: string | null;
}

// New response type for the functions-for-source endpoint
export interface FunctionForSource {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  sourceLine: number | null;
  sourceLineEnd: number | null;
  visibility: string | null;
  isAsync: boolean;
  kind: string | null;
}

export async function fetchFunctionsForSource(
  project: string,
  sourcePath: string,
): Promise<FunctionForSource[]>;
```

**Frontend (`ui/src/lib/extract-functions.ts`)**

```typescript
// Pure library, no React. Shape matches FunctionForSource so Tier 1 and Tier 2
// produce the same rows.
export interface ExtractedFunction {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  sourceLine: number;
  sourceLineEnd: number | null;
  visibility: null;        // Tier 2 doesn't infer visibility
  isAsync: boolean;
  kind: 'function' | 'method' | 'callback' | null;
}

// Walk the CodeMirror syntax tree and return one row per function-like
// definition. Returns [] for non-TS/JS languages or parse failures.
export function extractFunctions(code: string, language: string): ExtractedFunction[];

// Given an EditorView and a document position, return the identifier at that
// position (or null if the position doesn't resolve to an identifier token).
export function findSymbolAtPos(view: EditorView, pos: number): string | null;
```

### 1.3 Component Interactions

```
CodeEditor mounts for a linked file
     │
     │ envelope.filePath = absolute source path
     ▼
Effect: load functions for this file
     │  1. Tier 1: fetchFunctionsForSource(project, envelope.filePath)
     │     if non-empty → use it
     │  2. Tier 2: extractFunctions(envelope.code, envelope.language)
     │     fallback when Tier 1 empty
     ▼
State: functions[] + editorView (captured via onEditorReady)
     │
     ▼
Toolbar: <FunctionJumpDropdown functions={...} onJump={(line) => jumpTo(line)}/>
     │
     ▼  click on a function
jumpToLine(editorView, line)
     │  → view.dispatch({ selection: ..., effects: EditorView.scrollIntoView(pos) })

Separately — click on an identifier in the editor:
CodeMirrorWrapper with onSymbolClick
     │  1. click handler intercepts mouseup
     │  2. findSymbolAtPos(view, view.state.selection.main.head) → symbolName
     │  3. calls onSymbolClick(symbolName, clickRect)
     ▼
CodeEditor's handleSymbolClick:
     │  - Derive file stem from envelope.filePath (basename without ext)
     │  - fetchPseudoReferences(project, symbolName, fileStem)
     │  - Store references + anchorRect in state
     ▼
<ReferencesPopover references={...} anchorRect={rect} onNavigate={...}/>
     │  click on a reference:
     │    - if same file → jumpToLine(editorView, referenceLine)
     │    - if different file + that file is linked in session → focus its editor + jumpToLine
     │    - if unlinked → not clickable (show path only, Phase 5 handles linking)
```

**Refresh triggers for the functions list:**
- On initial mount (once envelope is loaded)
- After a successful `Sync` (envelope.code may have changed from disk)
- After a successful `Push` (envelope.code was persisted; db may have re-ingested if pseudo files are watched — but we don't rely on that, we refresh anyway)
- After content changes in the editor, debounced 200ms (covers the Tier 2 fallback path where the user is actively editing)

Dropdown refresh does NOT require the pseudo-db to have re-ingested — Tier 2 always uses current in-editor content, so edits update the dropdown immediately even if Tier 1 is stale.

---

## 2. Function Blueprints

### 2.1 Backend

#### `getFunctionsForSource(sourceFilePath: string): FunctionForSource[]`

New public method on `PseudoDbService` in `src/services/pseudo-db.ts`.

**Pseudocode:**
1. Prepare SQL:
```sql
SELECT
  m.name,
  m.params,
  m.return_type,
  m.is_exported,
  m.source_line,
  m.source_line_end,
  m.visibility,
  m.is_async,
  m.kind
FROM methods m
JOIN files f ON f.id = m.file_id
WHERE f.source_file_path = ?
ORDER BY m.source_line ASC NULLS LAST, m.sort_order ASC
```
2. Run with `sourceFilePath` as the parameter.
3. Map rows to `FunctionForSource[]` — convert `is_exported` / `is_async` integers to booleans.
4. Return the array (empty array if no matches).

**Error handling:** SQL failure throws (consistent with other DB methods). Unknown sourceFilePath returns empty array — not an error.

**Edge cases:**
- Multiple pseudo files pointing at the same source path (shouldn't happen, but defensive): returns methods from whichever file_id is first encountered, deduped is not needed because each file+method combo is independent.
- `source_line` is null (scan couldn't find the line): still included, but with `sourceLine: null`. Dropdown will show "?" for the line marker.
- Absolute vs relative path mismatch: the db stores whatever `resolveSourceFilePath` wrote, which is absolute. Callers MUST pass absolute paths. Document this in the method signature.

**Test strategy:** bun:test unit in pseudo-db.test.ts — seed a file via `upsertFile`, call `getFunctionsForSource` with the absolute source path, assert the returned array matches.

#### `GET /api/pseudo/functions-for-source` — new endpoint in `src/routes/pseudo-api.ts`

**Query params:** `project` (existing), `sourcePath` (new).

**Pseudocode:**
1. Validate both are present.
2. Call `getPseudoDb(project).getFunctionsForSource(sourcePath)`.
3. Return `Response.json({ functions })`.

**Error handling:** Missing `sourcePath` → 400. DB errors bubble through the existing try/catch.

**Test strategy:** vitest in pseudo-api.test.ts — seed via `upsertFile`, hit the endpoint via `handlePseudoAPI`, verify response shape.

### 2.2 Frontend — data layer

#### `fetchFunctionsForSource(project, sourcePath): Promise<FunctionForSource[]>`

New function in `ui/src/lib/pseudo-api.ts`.

**Pseudocode:**
1. Build URL: `/api/pseudo/functions-for-source?project=${encode}&sourcePath=${encode}`
2. Fetch, check `response.ok`.
3. Return `data.functions || []`.

**Error handling:** On non-OK response, throw with the statusText. Callers (the CodeEditor effect) catch and fall back to Tier 2.

### 2.3 Frontend — Tier 2 Lezer walker

#### `extractFunctions(code: string, language: string): ExtractedFunction[]`

New pure function in `ui/src/lib/extract-functions.ts`.

**Approach:** Instead of depending on CodeMirror's live `syntaxTree`, parse the code directly using the Lezer TS parser. The `javascript` package from `@codemirror/lang-javascript` provides a `javascriptLanguage` export with a `parser` property (the Lezer parser). We can call `parser.parse(code)` to get a parse tree without needing a live `EditorView`.

However, this ties the test runner to `@codemirror/lang-javascript` loading correctly in bun. If that proves flaky, Phase 4 can switch to a regex-based fallback for Tier 2. The blueprint leaves both options open — prefer Lezer; fall back to regex if Lezer parse fails under bun:test.

**Pseudocode (Lezer path):**
1. If `language !== 'typescript' && language !== 'javascript'` → return `[]`.
2. Import `javascriptLanguage` from `@codemirror/lang-javascript` (TS/JSX handled the same since we don't configure jsx/tsx separately).
3. `const tree = javascriptLanguage.parser.parse(code);`
4. Walk the tree with a cursor. For each node whose type matches one of:
   - `FunctionDeclaration`
   - `MethodDeclaration`
   - `ClassMethod` / class method shapes
   - Arrow/anonymous assigned to a `VariableDeclarator` (extract the variable name)
5. For each match, extract:
   - `name`: identifier child of the declaration (or the VariableDeclarator for arrows)
   - `params`: text between the matched `(` and `)` via `code.slice(paramsNode.from, paramsNode.to)`
   - `sourceLine`: compute from `tree.lineAt(node.from).number` (or by manually counting `\n` up to `node.from` — Lezer doesn't directly give lines; we do it ourselves since we have the raw code)
   - `isExported`: check if the parent is an `ExportDeclaration` or prefixed with `export`
   - `isAsync`: check if the declaration text starts with `async`
   - `kind`: `function` for top-level, `method` for class methods, `callback` for arrow functions assigned to a variable
6. Return the sorted array.

**Pseudocode (regex fallback, called when Lezer parse throws):**
Regex-based detection matching the Phase 3 scanner's TS patterns (see `findMethodLineForLanguage` in pseudo-db.ts). Returns the same shape.

**Error handling:** Any parse exception is caught; fall back to regex. Regex always succeeds or returns empty.

**Edge cases:**
- Empty string → []
- Only comments → []
- Malformed TS that Lezer can't parse → regex fallback
- Nested functions: include them all (dropdown may get long; user can search)
- Anonymous callbacks not assigned to any name: skip (no identifier to jump to)

**Test strategy:**
- `extractFunctions('', 'typescript')` → []
- `extractFunctions('function foo() {}', 'typescript')` → one row, name='foo', sourceLine=1
- `extractFunctions('export async function bar(x: number): string { return ""; }', 'typescript')` → isExported=true, isAsync=true, params='x: number', returnType='string'
- `extractFunctions('const baz = () => 1;', 'typescript')` → one row, name='baz', kind='callback'
- Class method case, multiple methods, sorted by line
- Non-TS language returns []
- Malformed code → regex fallback still returns something useful

#### `findSymbolAtPos(view: EditorView, pos: number): string | null`

Helper for click-on-symbol detection.

**Pseudocode:**
1. Get the document at position `pos`.
2. Use `syntaxTree(view.state).resolveInner(pos, 0)` to find the innermost node at that position (import `syntaxTree` from `@codemirror/language`).
3. If the node type is an identifier-like type (`VariableName`, `PropertyName`, `MethodName`, or similar — exact type names TBD via inspection), return `view.state.doc.sliceString(node.from, node.to)`.
4. Otherwise walk up to parent and check again, up to 2 levels.
5. Return null if no identifier found.

**Error handling:** Catch any error and return null. Click-on-symbol is best-effort; no need to crash the editor.

**Test strategy:** Integration-style — not unit tested in Phase 4 (requires a mounted EditorView). Verified manually.

### 2.4 Frontend — React components

#### `FunctionJumpDropdown` component

File: `ui/src/components/editors/FunctionJumpDropdown.tsx`

**Props:**
```typescript
interface FunctionJumpDropdownProps {
  functions: Array<{
    name: string;
    sourceLine: number | null;
    isExported: boolean;
    params: string;
    kind: string | null;
    visibility: string | null;
  }>;
  onJump: (line: number) => void;
}
```

**Behavior:**
1. Small toolbar button showing `λ <count>` or similar; click opens a dropdown.
2. Dropdown has a search input at the top — debounced fuzzy filter on function name.
3. List of functions with: name (bold), params (muted), line number (right-aligned), export badge (green dot).
4. Click a row → `onJump(sourceLine)` + close dropdown.
5. Keyboard: arrow up/down to navigate, Enter to select, Escape to close.
6. Close on outside click.
7. If `functions[].sourceLine` is null for a row, display "?" and disable the click.

**Structure:** Portal pattern similar to `CallsPopover.tsx` — `createPortal` into `document.body` with fixed positioning under the toolbar button.

**Error handling:** If `functions` array is empty, render a disabled button with tooltip "No functions found".

**Edge cases:**
- All functions have `sourceLine: null` → dropdown still opens but all rows disabled.
- Very long lists (100+ functions): virtualize? Skip for Phase 4 — just render all and rely on search to narrow.
- Search matches ignore case and diacritics.

#### `ReferencesPopover` component

File: `ui/src/components/editors/ReferencesPopover.tsx`

**Props:**
```typescript
interface ReferencesPopoverProps {
  references: Array<{ file: string; callerMethod: string }>;
  symbolName: string;
  anchorRect: DOMRect;
  currentFilePath: string | null;       // for "is this our file?" check
  linkedFilePathsInSession: string[];   // the set of already-linked file paths
  onNavigateSameFile: (line: number) => void;  // not yet fully implementable in Phase 4 — Phase 5 adds line resolution
  onNavigateLinkedFile: (filePath: string, line: number) => void;
  onClose: () => void;
}
```

**Behavior:**
1. Positioned via `createPortal` and the `anchorRect` — mirror the positioning logic from CallsPopover.tsx lines 42-51.
2. Header: `References to "<symbolName>"` + close button.
3. Body: each reference row shows `<callerMethod> in <file basename>`.
4. Click logic (Phase 4 scope):
   - Same file (reference.file === currentFilePath): currently we don't have a per-reference line number from `/api/pseudo/references` — the endpoint returns `{ file, callerMethod }` only. So clicking same-file refs in Phase 4 is a no-op with a tooltip "Line lookup coming in Phase 5". NOTE: a cheap improvement is to enrich the references endpoint to include `callerMethod`'s sourceLine, but that's scope creep — Phase 5 should address it.
   - Other linked file: same limitation — no-op for Phase 4. We still SHOW the file in the popover so users see the reference exists.
   - Unlinked file: show the file but render it as plain text (not a button).
5. Close on outside click, Escape key.

**Reconsideration:** If Phase 4 ships with references that aren't actually clickable, that's a weak feature. Let me revise: add an optional enrichment in the backend to include the caller method's source line. That's a one-SQL-query change and lands Feature B's click navigation in Phase 4.

**Revised scope — enrich `/api/pseudo/references`:**

Add an optional `includeSourceLine=1` query param. When set, the response includes `sourceLine` per caller (from `methods.source_line`). This is one small DB query change in `getReferences()`. With this, Feature B actually navigates same-file references end-to-end in Phase 4.

**Updated references endpoint behavior:**
```typescript
// pseudo-db.ts — modify getReferences to include source_line from the caller
interface Reference {
  file: string;
  callerMethod: string;
  sourceLine: number | null;   // NEW
}
```

This adds one more small task to Phase 4 (`backend-references-sourceline`) — see Task Graph below.

#### `CodeEditor.tsx` integration

Modifications to `ui/src/components/editors/CodeEditor.tsx`:

1. **Capture `EditorView`** via the SnippetEditor's onEditorReady or similar. If not already exposed, wire it through. (Check during implementation.)

2. **Load functions on mount + on syncs + on content changes:**
```typescript
const [functions, setFunctions] = useState<ExtractedFunction[]>([]);

useEffect(() => {
  if (!envelope || !currentSession) return;
  let cancelled = false;

  const load = async () => {
    // Tier 1
    try {
      const tier1 = await fetchFunctionsForSource(currentSession.project, envelope.filePath);
      if (!cancelled && tier1.length > 0) {
        setFunctions(tier1);
        return;
      }
    } catch (err) {
      console.warn('Tier 1 functions lookup failed:', err);
    }
    // Tier 2 fallback
    const tier2 = extractFunctions(envelope.code, envelope.language);
    if (!cancelled) setFunctions(tier2);
  };

  load();
  return () => { cancelled = true; };
}, [envelope?.filePath, envelope?.code, envelope?.language, currentSession?.project, refreshKey]);
```

`refreshKey` is a counter incremented after sync/push to force re-load.

3. **Add FunctionJumpDropdown to the toolbar** in `mergedControls` alongside the existing Push / Preview / Sync / Pseudo / Kebab buttons.

4. **jumpToLine helper** captured via onEditorReady:
```typescript
const editorViewRef = useRef<EditorView | null>(null);
const handleEditorReady = useCallback((view: EditorView | null) => {
  editorViewRef.current = view;
}, []);
const jumpToLine = useCallback((line: number) => {
  const view = editorViewRef.current;
  if (!view) return;
  const pos = view.state.doc.line(line).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start' }),
  });
  view.focus();
}, []);
```

5. **onSymbolClick handler:**
```typescript
const [popover, setPopover] = useState<{ symbol: string; refs: Reference[]; rect: DOMRect } | null>(null);

const handleSymbolClick = useCallback(async (symbol: string, rect: DOMRect) => {
  if (!currentSession || !envelope) return;
  const fileStem = fileStemFromPath(envelope.filePath);
  try {
    const refs = await fetchPseudoReferences(currentSession.project, symbol, fileStem);
    if (refs.length > 0) {
      setPopover({ symbol, refs, rect });
    }
    // silently ignore zero-results — not every click is a function reference
  } catch (err) {
    console.warn('References lookup failed:', err);
  }
}, [currentSession, envelope]);
```

6. **Render the ReferencesPopover** when `popover` is non-null.

7. **Pass `onSymbolClick` down through SnippetEditor → CodeMirrorWrapper**. This requires SnippetEditor to also forward the prop if it doesn't already — check during implementation.

### 2.5 `CodeMirrorWrapper.tsx` addition

Add prop:
```typescript
onSymbolClick?: (symbol: string, rect: DOMRect) => void;
```

When set, install a `ViewPlugin` with a `domEventHandlers` map:
```typescript
{
  click(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const symbol = findSymbolAtPos(view, pos);
    if (!symbol) return false;
    // Get a DOMRect around the clicked token
    const coords = view.coordsAtPos(pos);
    if (!coords) return false;
    const rect = new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
    onSymbolClick(symbol, rect);
    return false; // let the normal click selection behavior continue
  }
}
```

Install the plugin via `EditorView.domEventHandlers(...)`. Only add the extension when `onSymbolClick` is provided.

### 2.6 Modify `getReferences` to include source_line

`src/services/pseudo-db.ts`:
```typescript
getReferences(methodName: string, fileStem: string): Array<{ file: string; callerMethod: string; sourceLine: number | null }> {
  const rows = this.db.prepare(`
    SELECT f.file_path, m.name, m.source_line
    FROM method_calls mc
    JOIN methods m ON m.id = mc.caller_method_id
    JOIN files f ON f.id = m.file_id
    WHERE mc.callee_name = ? AND mc.callee_file_stem = ?
  `).all(methodName, fileStem) as any[];

  return rows.map(r => ({
    file: r.file_path,
    callerMethod: r.name,
    sourceLine: r.source_line,
  }));
}
```

Update the `Reference` type in `ui/src/lib/pseudo-api.ts` to add `sourceLine: number | null` (optional for back-compat).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: backend-functions-for-source
    files:
      - src/services/pseudo-db.ts
      - src/routes/pseudo-api.ts
    tests:
      - src/services/__tests__/pseudo-db.test.ts
      - src/routes/pseudo-api.test.ts
    description: "Add getFunctionsForSource() DB method + GET /api/pseudo/functions-for-source endpoint. Also enrich getReferences() to include caller sourceLine. Tests cover both."
    parallel: true
    depends-on: []

  - id: ui-pseudo-api-client
    files:
      - ui/src/lib/pseudo-api.ts
    tests: []
    description: "Extend PseudoMethod with Phase 3 optional fields. Add FunctionForSource type and fetchFunctionsForSource() method. Extend Reference type with optional sourceLine."
    parallel: true
    depends-on: []

  - id: ui-extract-functions
    files:
      - ui/src/lib/extract-functions.ts
      - ui/src/lib/__tests__/extract-functions.test.ts
    tests:
      - ui/src/lib/__tests__/extract-functions.test.ts
    description: "New Lezer walker for TS/JS function extraction. Exports extractFunctions(code, language) + findSymbolAtPos(view, pos). Falls back to regex if Lezer parse fails. Unit tests cover happy paths, malformed code, non-TS languages, anonymous callbacks, exported + async variants."
    parallel: true
    depends-on: []

  - id: ui-codemirror-wrapper-symbol-click
    files:
      - ui/src/components/editors/CodeMirrorWrapper.tsx
    tests: []
    description: "Add optional onSymbolClick prop. Install a domEventHandlers click extension when provided that calls findSymbolAtPos and fires the callback with the symbol name + DOMRect."
    parallel: true
    depends-on: [ui-extract-functions]

  - id: ui-function-jump-dropdown
    files:
      - ui/src/components/editors/FunctionJumpDropdown.tsx
    tests: []
    description: "New searchable combobox component. Props: functions[] + onJump(line). Portal dropdown under a toolbar button with search, keyboard nav, close-on-outside-click. Disabled rows for functions with null sourceLine."
    parallel: true
    depends-on: [ui-pseudo-api-client]

  - id: ui-references-popover
    files:
      - ui/src/components/editors/ReferencesPopover.tsx
    tests: []
    description: "New popover component showing references to a clicked symbol. Mirrors CallsPopover positioning pattern. Same-file refs jump via onNavigateSameFile. Other linked-file refs jump via onNavigateLinkedFile. Unlinked file refs are shown but not clickable."
    parallel: true
    depends-on: [ui-pseudo-api-client]

  - id: ui-codeeditor-integration
    files:
      - ui/src/components/editors/CodeEditor.tsx
      - ui/src/components/editors/SnippetEditor.tsx
    tests: []
    description: "Wire everything together in CodeEditor. Capture EditorView via onEditorReady, add jumpToLine helper, load Tier 1 → Tier 2 functions list, pass FunctionJumpDropdown in merged toolbar, plumb onSymbolClick through SnippetEditor → CodeMirrorWrapper, render ReferencesPopover on click. Refresh on sync/push/content change."
    parallel: false
    depends-on: [ui-function-jump-dropdown, ui-references-popover, ui-codemirror-wrapper-symbol-click, backend-functions-for-source]
```

### Execution Waves

**Wave 1 (3 parallel):**
- `backend-functions-for-source`
- `ui-pseudo-api-client`
- `ui-extract-functions`

**Wave 2 (3 parallel):**
- `ui-codemirror-wrapper-symbol-click` (depends on ui-extract-functions)
- `ui-function-jump-dropdown` (depends on ui-pseudo-api-client)
- `ui-references-popover` (depends on ui-pseudo-api-client)

**Wave 3 (1 task):**
- `ui-codeeditor-integration`

### Summary
- Total tasks: 7
- Total waves: 3
- Max parallelism: 3

---

## 4. Out of Scope / Deferred to Phase 5

- **Cross-file navigation to unlinked files.** Clicking a reference that lives in a file not currently linked in the session shows the file path but isn't clickable. Phase 5's Feature B adds the "offer to link" flow.
- **Go-to-definition right-click menu.** Phase 5 adds the explicit right-click / cmd-click affordance for jumping to a definition across files.
- **Cross-artifact code search** (global Cmd+K search over pseudo FTS + linked code). Phase 5 section 5.2.
- **Caller popover for Lezer-only (Tier 2) files.** References only work via the pseudo-db, so files with no pseudo index won't show references on click. Acceptable — the dropdown still works via Tier 2.
- **Search-by-prefix in the dropdown.** Phase 4 uses a simple substring filter. Fuzzy search is a polish task.
- **Multi-file function jump** (jumping to a function defined in a different linked file via the dropdown). Phase 4's dropdown is scoped to the CURRENT file only.

---

## 5. Validation

At the end of Phase 4 the following must work:

1. **Backend endpoint:** `curl "http://localhost:3737/api/pseudo/functions-for-source?project=...&sourcePath=/abs/path/file.ts"` returns `{ functions: [...] }` with all methods indexed for that source file. Unknown source path → `{ functions: [] }`.
2. **Tier 1 happy path:** open a linked TS file that has a `.pseudo` sibling → open the function dropdown → see functions listed with correct line numbers → click one → editor scrolls to that line.
3. **Tier 2 fallback:** open a linked TS file with NO `.pseudo` → dropdown still populates via the Lezer walker (best-effort) → jumps still work.
4. **Export badge:** exported functions show a visible marker in the dropdown.
5. **Search filter:** typing narrows the function list by name.
6. **Click-on-symbol:** click a function name in the editor → if there are cross-file callers in the pseudo-db, a popover shows them. No-op (no popover) when no references found.
7. **Same-file reference navigation:** click a caller in the popover that points to a method in the same file → editor jumps to that caller's line (enabled by the enriched getReferences sourceLine).
8. **Refreshes:** click Sync, the dropdown re-loads from disk. Click Push, same. Type in the editor, dropdown updates after 200ms debounce (Tier 2 path).
9. **Tests green:** new backend tests pass, new extract-functions tests pass, no regressions in existing tests.
10. **Phase 3 integrity:** pseudo-db and pseudo-parser tests still pass unchanged.

---

## 6. Risks + Mitigation

### Tier 2 Lezer parse cost
**Risk:** parsing large TS files on every keystroke blocks the UI.
**Mitigation:** 200ms debounce. If still slow on real files, cache per content-hash. Further fallback: only re-parse on focus-blur.

### Click-on-symbol false positives
**Risk:** clicks on keywords / comments / strings fire lookups for unrelated tokens.
**Mitigation:** `findSymbolAtPos` returns null for non-identifier nodes. The handler also silently drops zero-result responses (no popover flicker).

### Lezer package availability under bun:test
**Risk:** `@codemirror/lang-javascript`'s parser may not import cleanly in bun:test (DOM-free environment).
**Mitigation:** the extract-functions.test.ts file plans Lezer-based tests but includes a fallback path. If Lezer tests fail under bun, we switch those tests to exercise only the regex fallback path (still meaningful coverage) and leave Lezer testing for the browser integration.

### SnippetEditor prop plumbing
**Risk:** `onSymbolClick` must flow through `SnippetEditor` → `CodeMirrorWrapper`. If SnippetEditor doesn't already pass arbitrary props, we need to add one.
**Mitigation:** trivial add — SnippetEditor already passes `onEditorReady` and other callbacks through, so the pattern is already established.

### Reference popover positioning across scroll
**Risk:** popover `anchorRect` goes stale if the user scrolls after clicking.
**Mitigation:** close the popover on scroll. Mirror the existing CallsPopover grace-period mouse handlers.

### Sync churn on refresh
**Risk:** every keystroke triggers a Tier 1 fetch.
**Mitigation:** the effect deps intentionally trigger Tier 1 only on `envelope.filePath` change (not on `envelope.code`). Tier 2 runs from local state on every content change via the debounced effect.

---

## 7. Implementation Notes

- **File stem derivation:** `fileStem = basename(filePath).replace(/\.(ts|tsx|js|jsx|py|cs|cpp|c|h|hpp|go|rs)$/, '')`. Used when calling `fetchPseudoReferences`.
- **Keep the Phase 3 scan behavior:** Phase 3's `scanSourceFileForLines` now preserves pre-set sourceLine values. Phase 4 does not interact with the scanner; it just consumes what's in the DB.
- **Toolbar layout:** add the FunctionJumpDropdown button BEFORE the existing Preview/Sync buttons so it's easier to reach when navigating.
- **Dropdown button label:** consider "Functions (N)" or a symbol `{}` + count. Decide during implementation.
