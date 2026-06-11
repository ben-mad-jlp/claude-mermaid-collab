# Blueprint: Phase 5 — Cross-File Navigation + Global Code Search

Phase 5 of the snippet-enhancement migration. Completes the navigation story with two features that build on the Phase 4 primitives:

1. **Feature B — Cross-File Navigation:** explicit Go-to-Definition from a clicked function call that navigates across files. If the target file isn't already linked in the session, a confirmation dialog offers to link it. Triggered by cmd/ctrl+click or right-click on an identifier. Adds a small nav-history stack with a back button in the CodeEditor toolbar.

2. **Cross-Artifact Code Search (Cmd+K):** top-level search overlay that queries pseudo FTS (existing) AND linked snippet content (new backend fan-out) in one unified result list. Click a result to navigate via the same primitives as Feature B.

## Source Artifacts
- `migration-plan` — Phase 5 section (5.1 + 5.2)

## Phase 4 Dependencies (Already Landed)
- `/api/pseudo/source-link?name=...&hintFileStem=...` endpoint (Phase 3)
- `jumpToLine(view, line)` primitive in CodeEditor via `editorViewRef`
- `findSymbolAtPos(view, pos)` + `extractFunctions(code, language)` in `ui/src/lib/extract-functions.ts`
- `CodeMirrorWrapper.onSymbolClick` (plain click → references popover)
- Session linked snippets via `useSessionStore`
- Linking flow: `api.createSnippet(project, session, name, envelopeJson)` → `api.syncCodeFromDisk(id)` (the pattern already used in `Sidebar.handleLinkFile`)

## Scope Decisions
- **cmd/ctrl+click AND right-click both trigger Go-to-Definition.** No separate context menu in Phase 5 — right-click directly fires the definition lookup. A full context menu with multiple options can be added later.
- **Resolver uses `/api/pseudo/source-link` only.** No grep fallback in Phase 5. Files with no pseudo index fall through to "not found" with a toast. The migration plan mentioned a grep fallback as optional; we defer it to keep scope tight.
- **Global Code Search fan-out:** pseudo FTS (existing `getPseudoDb().search()`) + in-memory content grep over linked snippets (simple substring / case-insensitive regex). No ripgrep dependency. Results capped at 100 total across both sources.
- **Nav history is per-CodeEditor and per-session.** Clearing happens on session switch. Max 20 entries. Simple stack, no forward button.
- **GlobalSearch overlay lives in the top-level App layout** so Cmd+K works from anywhere in the UI. Click-through uses the `selectSnippet(id)` + `jumpToLine` path.
- **Feature B clicks from GlobalSearch DO NOT offer to link.** If a search result points at a linked snippet, focus it; if it points at a pseudo-indexed file that's not linked, the result row still shows with a tooltip "Not linked — open via Feature B's Go to Definition" but the click is a no-op (or focuses the containing pseudo viewer — out of scope).

---

## 1. Structure Summary

### 1.1 Files

**Backend**
- [ ] `src/routes/code-api.ts` — **modify** — add new `POST /api/code/search?project=...&session=...` endpoint that fans out to pseudo FTS + linked snippet content search
- [ ] `src/routes/__tests__/code-api.test.ts` — **modify** — add tests for `/search`

**Frontend library**
- [ ] `ui/src/lib/pseudo-api.ts` — **modify** — add `fetchSourceLink(project, name, hintFileStem?)` client for the Phase 3 endpoint (not yet in the UI client)
- [ ] `ui/src/lib/code-search-api.ts` — **new** — `fetchCodeSearch(project, session, query)` client + response types
- [ ] `ui/src/lib/definition-resolver.ts` — **new** — pure function `resolveDefinition(sourceLinks, linkedSnippets)` that maps backend candidates to a `ResolveDecision` (`found-linked` / `needs-link` / `not-found`)
- [ ] `ui/src/lib/__tests__/definition-resolver.test.ts` — **new** — unit tests covering all three branches + multi-candidate picker
- [ ] `ui/src/hooks/useNavHistory.ts` — **new** — small hook backing a bounded stack of nav entries (snippetId + line) with push / back / clear
- [ ] `ui/src/hooks/__tests__/useNavHistory.test.ts` — **new** — unit tests for push/back/clear/bounded-size

**Frontend components**
- [ ] `ui/src/components/editors/CodeMirrorWrapper.tsx` — **modify** — add optional `onSymbolGoToDefinition?: (symbol: string, rect: DOMRect) => void` prop. Install two listeners: `contextmenu` (right-click) and `mousedown` with `metaKey || ctrlKey` modifier. Both call the same handler with the identifier under cursor.
- [ ] `ui/src/components/editors/DefinitionPickerPopover.tsx` — **new** — portal popover listing multiple definition candidates; click one to navigate
- [ ] `ui/src/components/editors/LinkAndNavigateDialog.tsx` — **new** — modal confirming "Link `<path>` and navigate to `<symbol>` at line N?" with Link+Navigate / Cancel buttons
- [ ] `ui/src/components/layout/GlobalSearch.tsx` — **new** — Cmd+K overlay with search input, unified results list (pseudo + code), keyboard navigation, click-to-jump
- [ ] `ui/src/components/editors/CodeEditor.tsx` — **modify** — wire `onSymbolGoToDefinition` handler through SnippetEditor → CodeMirrorWrapper, call resolver, show picker/dialog as needed, add back-button in toolbar from nav history, push to history on jump
- [ ] `ui/src/components/editors/SnippetEditor.tsx` — **modify** — forward the new `onSymbolGoToDefinition` prop to the main CodeMirrorWrapper (mirror of Phase 4's `onSymbolClick` plumbing)
- [ ] `ui/src/App.tsx` (or top-level layout — implementer to confirm via Grep) — **modify** — mount `<GlobalSearch />` once at the app root so Cmd+K works globally

### 1.2 Type Definitions

**Backend (`src/routes/code-api.ts`)**

```typescript
// Request body for POST /api/code/search
interface CodeSearchRequest {
  query: string;
  limit?: number;  // default 50, max 100
}

// Response
interface CodeSearchResult {
  kind: 'pseudo' | 'code';
  filePath: string;     // absolute path (for linked snippets, this is envelope.filePath;
                        // for pseudo hits, this is files.source_file_path if known, else the .pseudo path)
  methodName?: string;  // for pseudo hits with a matched method
  line?: number;        // line number in the source file, if known
  snippet: string;      // a short match-context excerpt with the query highlighted via <mark>
  snippetId?: string;   // for kind: 'code', the linked snippet ID to focus
}

interface CodeSearchResponse {
  results: CodeSearchResult[];
  truncated: boolean;
}
```

**Frontend (`ui/src/lib/definition-resolver.ts`)**

```typescript
import type { SourceLinkCandidate, PseudoFileSummary } from './pseudo-api';
import type { Snippet } from '@/types';

export interface FoundLinkedSnippet {
  type: 'found-linked';
  snippetId: string;
  line: number;
}

export interface NeedsLink {
  type: 'needs-link';
  candidate: SourceLinkCandidate;
}

export interface NeedsLinkMultiple {
  type: 'needs-link-picker';
  candidates: SourceLinkCandidate[];
}

export interface NotFound {
  type: 'not-found';
}

export type ResolveDecision = FoundLinkedSnippet | NeedsLink | NeedsLinkMultiple | NotFound;

export function resolveDefinition(
  candidates: SourceLinkCandidate[],
  linkedSnippets: Array<{ id: string; filePath: string }>,
): ResolveDecision;
```

**Frontend (`ui/src/hooks/useNavHistory.ts`)**

```typescript
export interface NavEntry {
  snippetId: string;
  line: number;
}

export interface NavHistory {
  entries: NavEntry[];
  push(entry: NavEntry): void;
  back(): NavEntry | null;  // returns the *previous* entry and pops
  clear(): void;
  canGoBack: boolean;
}

export function useNavHistory(maxEntries?: number): NavHistory; // default 20
```

### 1.3 Component Interactions

```
User cmd-clicks (or right-clicks) an identifier in CodeEditor
     │
     │ CodeMirrorWrapper's new extension fires
     ▼
onSymbolGoToDefinition(symbol, rect)
     │
     ▼
CodeEditor.handleGoToDefinition(symbol, rect)
     │  1. Derive currentFileStem from envelope.filePath
     │  2. fetchSourceLink(project, symbol, currentFileStem) → candidates[]
     │  3. resolveDefinition(candidates, linkedSnippetsInSession) → decision
     ▼
switch (decision.type) {
  case 'found-linked':
     // Push current location onto nav history
     navHistory.push({ snippetId: currentSnippetId, line: currentCursorLine });
     // Focus the target snippet and jump
     selectSnippet(decision.snippetId);
     // Defer the line jump until the new editor is mounted (useEffect on selectedSnippetId)
     pendingJump = { snippetId: decision.snippetId, line: decision.line };
     break;

  case 'needs-link':
     // Show LinkAndNavigateDialog
     setLinkDialog({ candidate: decision.candidate, symbol });
     // On confirm: linkFile(candidate.sourceFilePath) → then focus + jump
     break;

  case 'needs-link-picker':
     // Show DefinitionPickerPopover
     setPickerPopover({ candidates: decision.candidates, rect, symbol });
     // On pick: same as 'needs-link' with the selected candidate
     break;

  case 'not-found':
     setFlashMessage('Definition not found');
     break;
}
```

**Global Code Search (Cmd+K):**

```
User presses Cmd+K (global keyboard listener in GlobalSearch)
     │
     ▼
GlobalSearch overlay opens
     │
     │ User types query (debounced 200ms)
     ▼
fetchCodeSearch(project, session, query)
     │  Backend: pseudoDb.search(query) + grep over linked snippet envelopes
     ▼
Results list renders — unified kind='pseudo' and kind='code' rows
     │
     │ User clicks a result (or Enter on highlighted)
     ▼
switch (result.kind) {
  case 'code':  // linked snippet content match
     selectSnippet(result.snippetId);
     pendingJump = { snippetId: result.snippetId, line: result.line };
     close overlay;
     break;
  case 'pseudo': // pseudo-db hit
     if (result.line != null) {
        // Try to find a linked snippet with matching source path
        const existing = linkedSnippets.find(s => s.filePath === result.filePath);
        if (existing) {
           selectSnippet(existing.id);
           pendingJump = { ... };
        } else {
           // Show the LinkAndNavigateDialog to offer linking
           setLinkDialog({ candidate: { sourceFilePath: result.filePath, sourceLine: result.line, ... } });
        }
     }
     break;
}
```

**Nav history back button:**

```
User clicks ← button in CodeEditor toolbar
     │
     ▼
navHistory.back() → NavEntry | null
     │
     ▼
If entry: selectSnippet(entry.snippetId) + pendingJump = { snippetId, line: entry.line }
```

**Pending jump mechanism:** because `selectSnippet` triggers a re-mount of the CodeEditor (new snippet id), the `jumpToLine` can't fire synchronously. Store a pending jump in a ref or module-level state, and have the new CodeEditor's mount effect check on mount: if `pendingJump.snippetId === currentSnippetId`, call jumpToLine and clear. Implement this as a small zustand slice or module singleton so cross-component coordination is easy.

---

## 2. Function Blueprints

### 2.1 Backend — `POST /api/code/search`

#### `handleCodeSearch(project, session, body): Promise<Response>`

New handler in `src/routes/code-api.ts`.

**Pseudocode:**
1. Validate `body.query` is a non-empty string; 400 if not.
2. `const limit = Math.min(body.limit ?? 50, 100);`
3. **Pseudo source:** call `getPseudoDb(project).search(query)` (existing FTS). For each row, look up the method's source_line + the file's source_file_path via a small DB query (or extend `search()` to include them — pseudo-db.ts:355 `search()` returns `{ filePath, methodName, snippet, rank }` but does not include source_file_path/line — extend it in this task or do a second query per result).
4. Normalize pseudo hits to `CodeSearchResult` with `kind: 'pseudo'`.
5. **Code source:** load the `SnippetManager` for the session, list snippets, filter to `linked === true`, for each one parse the envelope and run a case-insensitive substring search across `envelope.code`. For each match, compute the line number (count `\n` before the match offset) and extract a short context excerpt (~80 chars around the match with the query wrapped in `<mark>`).
6. Cap total results at `limit`. Track `truncated = total_found > limit`.
7. Return `Response.json({ results, truncated })`.

**Error handling:** Snippet content that's not valid JSON is skipped silently. FTS errors bubble through try/catch.

**Edge cases:**
- Empty query → 400
- Query with only whitespace → 400
- No session (snippet source) → still run pseudo fan-out; `kind: 'code'` results empty
- Very long queries (>200 chars) → truncate to 200 for the content grep
- Regex special chars in query → escape before the content grep

**Test strategy:**
- Vitest integration: seed the db with a pseudo file + link a code snippet with known content, hit `/api/code/search?q=foo`, verify both kinds of results appear
- 400 on empty query
- `truncated: true` when results exceed limit

### 2.2 Frontend — data layer

#### `fetchSourceLink(project: string, name: string, hintFileStem?: string): Promise<SourceLinkCandidate[]>`

New client in `ui/src/lib/pseudo-api.ts` (sibling to `fetchFunctionsForSource`).

```typescript
const params = new URLSearchParams({ project, name });
if (hintFileStem) params.set('hintFileStem', hintFileStem);
const response = await fetch(`/api/pseudo/source-link?${params}`);
if (!response.ok) throw new Error(...);
const data = await response.json();
return data.candidates || [];
```

`SourceLinkCandidate` type already exists in pseudo-db.ts — add a matching type export in ui/src/lib/pseudo-api.ts to avoid importing from backend.

#### `fetchCodeSearch(project, session, query): Promise<CodeSearchResponse>`

New client in `ui/src/lib/code-search-api.ts`. POST to `/api/code/search` with the body. Error handling identical to other pseudo-api clients.

### 2.3 Frontend — `resolveDefinition` pure function

File: `ui/src/lib/definition-resolver.ts`

**Pseudocode:**
1. If `candidates.length === 0` → return `{ type: 'not-found' }`.
2. Walk the candidates; for each one, find a linked snippet whose `filePath === candidate.sourceFilePath`. Use a `Map` over linkedSnippets for O(1) lookups.
3. If exactly one candidate resolves to a linked snippet AND candidate has sourceLine → return `{ type: 'found-linked', snippetId, line }`.
4. If multiple candidates are linked → pick the exported one if present; otherwise return `{ type: 'needs-link-picker', candidates }` (even though they're linked, we need to disambiguate by letting the user pick).
   - Actually simpler: if multiple candidates AND at least one is linked AND all linked ones have the same source path → return found-linked for the first one.
   - If multiple candidates with DIFFERENT source paths → return needs-link-picker regardless of link state. Let the user see which file they're jumping to.
5. If exactly one candidate and it's NOT linked → return `{ type: 'needs-link', candidate }`.
6. If multiple candidates and NONE are linked → return `{ type: 'needs-link-picker', candidates }`.

**Error handling:** Pure function; no errors. Returns `not-found` when in doubt.

**Edge cases:**
- `candidate.sourceLine` is null → still usable for linking, but the jump will scroll to line 1 as a fallback. Resolver returns the candidate regardless; CodeEditor handles line fallback.
- Paths with different case (Windows) → string equality only for Phase 5. No normalization.

**Test strategy:** 10–12 unit tests covering every branch + edge cases. Pure function, easy to test.

### 2.4 Frontend — `useNavHistory` hook

File: `ui/src/hooks/useNavHistory.ts`

```typescript
import { useState, useCallback } from 'react';

export interface NavEntry {
  snippetId: string;
  line: number;
}

export function useNavHistory(maxEntries = 20) {
  const [entries, setEntries] = useState<NavEntry[]>([]);

  const push = useCallback((entry: NavEntry) => {
    setEntries(prev => {
      const next = [...prev, entry];
      if (next.length > maxEntries) next.shift();
      return next;
    });
  }, [maxEntries]);

  const back = useCallback((): NavEntry | null => {
    let result: NavEntry | null = null;
    setEntries(prev => {
      if (prev.length === 0) return prev;
      result = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    return result;
  }, []);
  // NOTE: `back()` is tricky because setState is async. Implement via a ref mirror instead:

  return { entries, push, back, clear: () => setEntries([]), canGoBack: entries.length > 0 };
}
```

**Implementation note:** the `back()` reading-during-set pattern needs care. Use a `useRef<NavEntry[]>` mirror to read the current stack synchronously, then setState to update:

```typescript
const entriesRef = useRef<NavEntry[]>([]);
useEffect(() => { entriesRef.current = entries; }, [entries]);

const back = useCallback((): NavEntry | null => {
  const current = entriesRef.current;
  if (current.length === 0) return null;
  const entry = current[current.length - 1];
  setEntries(current.slice(0, -1));
  return entry;
}, []);
```

**Edge cases:**
- Back when empty → null, no state change
- Push beyond maxEntries → evict oldest

**Test strategy:** vitest + React Testing Library's `renderHook`. Push/back/clear/bounded-size/canGoBack.

### 2.5 Frontend — `CodeMirrorWrapper` Go-to-Definition

Add `onSymbolGoToDefinition?: (symbol: string, rect: DOMRect) => void` prop. Install an extension via `EditorView.domEventHandlers` with:

```typescript
{
  contextmenu(event, view) {
    // Right-click
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const symbol = findSymbolAtPos(view, pos);
    if (!symbol) return false;
    event.preventDefault(); // suppress browser context menu
    const coords = view.coordsAtPos(pos);
    if (!coords) return false;
    onSymbolGoToDefinition(symbol, domRectFromCoords(coords));
    return true;
  },
  mousedown(event, view) {
    // Cmd/Ctrl+click
    if (!event.metaKey && !event.ctrlKey) return false;
    if (event.button !== 0) return false; // left button only
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const symbol = findSymbolAtPos(view, pos);
    if (!symbol) return false;
    event.preventDefault();
    const coords = view.coordsAtPos(pos);
    if (!coords) return false;
    onSymbolGoToDefinition(symbol, domRectFromCoords(coords));
    return true;
  },
}
```

**Conflict with Phase 4's onSymbolClick:** a cmd+click already triggers `click`, which fires onSymbolClick (references popover). To avoid firing both: in the Phase 4 `click` handler, check `event.metaKey || event.ctrlKey` and short-circuit (don't fire onSymbolClick when it's a cmd-click). This is a 1-line change to the existing handler.

### 2.6 Frontend — `DefinitionPickerPopover`

File: `ui/src/components/editors/DefinitionPickerPopover.tsx`

Portal popover listing candidates with `{ sourceFilePath, sourceLine, isExported }`. Click a row to invoke `onPick(candidate)`. Same positioning pattern as ReferencesPopover. Close on outside click + Escape.

### 2.7 Frontend — `LinkAndNavigateDialog`

File: `ui/src/components/editors/LinkAndNavigateDialog.tsx`

Standard modal with a message like:
```
Link src/utils/crypto.ts and navigate to `hashPassword` at line 42?

[Cancel]  [Link and Navigate]
```

Props:
```typescript
interface LinkAndNavigateDialogProps {
  open: boolean;
  onClose: () => void;
  candidate: SourceLinkCandidate;
  symbolName: string;
  onConfirm: () => Promise<void>; // parent handles the link + navigate
}
```

Confirm button shows a loading state while `onConfirm` resolves.

### 2.8 Frontend — `GlobalSearch` overlay

File: `ui/src/components/layout/GlobalSearch.tsx`

**Behavior:**
1. Mounted once at the app root. Listens for `cmd+k` / `ctrl+k` on the document.
2. Opens a modal overlay with a search input (autofocus) and results list.
3. Debounced 200ms fetch to `fetchCodeSearch(project, session, query)`.
4. Results sorted by rank, grouped by kind (pseudo first, then code).
5. Each result shows: icon (📄 for pseudo, 💻 for code) + filePath basename + match snippet (with `<mark>` rendered via `dangerouslySetInnerHTML` — the backend sanitizes input).
6. Keyboard: ArrowDown/ArrowUp, Enter to select, Escape to close.
7. Click or Enter: call a shared `handleSearchResultClick(result)` that:
   - For `kind: 'code'`: `selectSnippet(result.snippetId)` + set pendingJump + close
   - For `kind: 'pseudo'`: check linkedSnippets for a match on `filePath` → if found, same as code; if not, show LinkAndNavigateDialog (reuses the component from Feature B)

### 2.9 Frontend — `CodeEditor` Feature B integration

Modifications to `ui/src/components/editors/CodeEditor.tsx`:

1. Import: `fetchSourceLink`, `resolveDefinition`, `useNavHistory`, `DefinitionPickerPopover`, `LinkAndNavigateDialog`, the shared pending-jump module.

2. Use `useNavHistory` for the back stack.

3. Add `handleGoToDefinition` callback — uses a stable ref pattern (like `handleSymbolClick` from Phase 4) so it doesn't re-memoize on keystrokes.

4. Update the existing `click` extension in CodeMirrorWrapper to skip when metaKey/ctrlKey is pressed (so cmd+click doesn't fire BOTH onSymbolClick and onSymbolGoToDefinition).

5. Render `DefinitionPickerPopover` and `LinkAndNavigateDialog` conditionally.

6. Add a Back button in the mergedControls toolbar — disabled when `!canGoBack`; clicking calls `navHistory.back()` and navigates to the returned entry.

7. On mount: check the shared `pendingJump` state and call `jumpToLine` if it targets this snippet. Clear the pending jump after consumption.

8. Push onto nav history whenever `jumpToLine` is called for an external navigation (not for same-file clicks from the references popover — those don't need history).

### 2.10 Pending-jump shared state

Simplest: a tiny zustand slice in `ui/src/stores/pendingJump.ts`:

```typescript
import { create } from 'zustand';

interface PendingJumpState {
  pending: { snippetId: string; line: number } | null;
  setPending: (v: { snippetId: string; line: number } | null) => void;
  consume: (snippetId: string) => number | null;
}

export const usePendingJump = create<PendingJumpState>((set, get) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  consume: (snippetId) => {
    const { pending } = get();
    if (pending && pending.snippetId === snippetId) {
      set({ pending: null });
      return pending.line;
    }
    return null;
  },
}));
```

CodeEditor's mount effect:
```typescript
useEffect(() => {
  const line = usePendingJump.getState().consume(snippetId);
  if (line != null) {
    // Defer until editor view is ready
    // Option A: requestAnimationFrame loop until editorViewRef.current is set
    // Option B: store line in local state and fire on onEditorReady
  }
}, [snippetId]);
```

**Option B is cleaner.** Store the pending line in local state when detected on mount, and fire inside `handleEditorReady` when the view becomes available.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: backend-code-search
    files:
      - src/routes/code-api.ts
      - src/routes/__tests__/code-api.test.ts
    tests:
      - src/routes/__tests__/code-api.test.ts
    description: "New POST /api/code/search endpoint that fans out to pseudo FTS + linked snippet content grep. Returns unified CodeSearchResult[] with pseudo and code kinds. Integration tests covering 400, mixed results, truncation."
    parallel: true
    depends-on: []

  - id: ui-api-extensions
    files:
      - ui/src/lib/pseudo-api.ts
      - ui/src/lib/code-search-api.ts
    tests: []
    description: "Add fetchSourceLink (missing UI client for the Phase 3 endpoint) to pseudo-api.ts. Create new code-search-api.ts with fetchCodeSearch and types CodeSearchResult / CodeSearchResponse."
    parallel: true
    depends-on: []

  - id: ui-nav-history
    files:
      - ui/src/hooks/useNavHistory.ts
      - ui/src/hooks/__tests__/useNavHistory.test.ts
    tests:
      - ui/src/hooks/__tests__/useNavHistory.test.ts
    description: "New hook backing a bounded nav-history stack (push, back, clear, canGoBack). Uses a ref mirror so back() can read the current stack synchronously. Default max 20 entries. Unit tests via renderHook."
    parallel: true
    depends-on: []

  - id: ui-pending-jump-store
    files:
      - ui/src/stores/pendingJump.ts
    tests: []
    description: "Tiny zustand store holding a pending jump target { snippetId, line }. setPending + consume(snippetId). Used to coordinate selectSnippet -> new-editor-mount -> jumpToLine handoff across component remounts."
    parallel: true
    depends-on: []

  - id: ui-codemirror-go-to-def
    files:
      - ui/src/components/editors/CodeMirrorWrapper.tsx
    tests: []
    description: "Add onSymbolGoToDefinition prop + contextmenu + cmd/ctrl+click extension. IMPORTANT: also modify the existing click handler (Phase 4 onSymbolClick) to skip when metaKey/ctrlKey is held, so cmd-click fires only Go-to-Definition."
    parallel: true
    depends-on: []

  - id: ui-definition-resolver
    files:
      - ui/src/lib/definition-resolver.ts
      - ui/src/lib/__tests__/definition-resolver.test.ts
    tests:
      - ui/src/lib/__tests__/definition-resolver.test.ts
    description: "Pure function resolveDefinition(candidates, linkedSnippets) returning ResolveDecision. Branches: not-found, found-linked, needs-link, needs-link-picker. 10+ unit tests covering every branch."
    parallel: true
    depends-on: [ui-api-extensions]

  - id: ui-feature-b-dialogs
    files:
      - ui/src/components/editors/DefinitionPickerPopover.tsx
      - ui/src/components/editors/LinkAndNavigateDialog.tsx
    tests: []
    description: "Two new components. DefinitionPickerPopover: portal popover listing multiple candidates with file paths + line numbers, onPick callback. LinkAndNavigateDialog: modal confirming 'Link X and navigate to Y at line N?' with Cancel / Link+Navigate buttons, loading state on confirm."
    parallel: true
    depends-on: [ui-api-extensions]

  - id: ui-global-search
    files:
      - ui/src/components/layout/GlobalSearch.tsx
    tests: []
    description: "New Cmd+K overlay. Document-level keydown listener for cmd/ctrl+K to open. Debounced 200ms fetchCodeSearch. Unified results list with kind icons, keyboard nav (arrows/Enter/Escape). Click result: for code kind, selectSnippet + setPending + close; for pseudo kind, check linked snippets and either focus or open LinkAndNavigateDialog."
    parallel: true
    depends-on: [ui-api-extensions, ui-pending-jump-store, ui-feature-b-dialogs]

  - id: ui-codeeditor-feature-b
    files:
      - ui/src/components/editors/CodeEditor.tsx
      - ui/src/components/editors/SnippetEditor.tsx
    tests: []
    description: "Wire Feature B into CodeEditor. Forward onSymbolGoToDefinition through SnippetEditor. Add handleGoToDefinition callback using a stable ref pattern. Use useNavHistory for the back stack, add Back button to mergedControls. Render DefinitionPickerPopover + LinkAndNavigateDialog conditionally. On mount, consume pendingJump via the store; fire jumpToLine once onEditorReady captures the view. Push onto nav history on cross-file jumps (not same-file reference clicks)."
    parallel: false
    depends-on: [ui-codemirror-go-to-def, ui-definition-resolver, ui-feature-b-dialogs, ui-nav-history, ui-pending-jump-store]

  - id: ui-app-global-search
    files:
      - ui/src/App.tsx
    tests: []
    description: "Mount <GlobalSearch /> once at the app root layout so Cmd+K works globally. Implementer should Grep for App.tsx or the main layout component; mount near other top-level providers."
    parallel: false
    depends-on: [ui-global-search]
```

### Execution Waves

**Wave 1 (5 parallel):**
- `backend-code-search`
- `ui-api-extensions`
- `ui-nav-history`
- `ui-pending-jump-store`
- `ui-codemirror-go-to-def`

**Wave 2 (3 parallel):**
- `ui-definition-resolver` (depends on ui-api-extensions)
- `ui-feature-b-dialogs` (depends on ui-api-extensions)
- `ui-global-search` (depends on ui-api-extensions + ui-pending-jump-store + ui-feature-b-dialogs)

Wait — `ui-global-search` depends on `ui-feature-b-dialogs`, which is in the SAME wave. This means ui-global-search needs to be in wave 3, not wave 2. Let me re-derive:

**Wave 1 (5 parallel):** backend-code-search, ui-api-extensions, ui-nav-history, ui-pending-jump-store, ui-codemirror-go-to-def
**Wave 2 (2 parallel):** ui-definition-resolver, ui-feature-b-dialogs
**Wave 3 (1 task):** ui-global-search (depends on feature-b-dialogs from wave 2)
**Wave 4 (1 task):** ui-codeeditor-feature-b
**Wave 5 (1 task):** ui-app-global-search

5 waves, 10 tasks, max parallelism 5.

Actually ui-global-search and ui-codeeditor-feature-b can run in parallel — they touch different files. Let me check deps:
- ui-global-search: needs feature-b-dialogs (wave 2) ✓
- ui-codeeditor-feature-b: needs feature-b-dialogs + codemirror-go-to-def + definition-resolver + nav-history + pending-jump-store ✓

Both available after wave 2. Parallel in wave 3.

**Wave 3 (2 parallel):** ui-global-search, ui-codeeditor-feature-b
**Wave 4:** ui-app-global-search

4 waves, 10 tasks, max parallelism 5.

### Summary
- Total tasks: 10
- Total waves: 4
- Max parallelism: 5 (wave 1)

---

## 4. Out of Scope / Deferred

- **Grep fallback for unknown definitions.** Migration plan mentioned a ripgrep-backed `/api/code/find-definition` endpoint as a possible Feature B enhancement. Phase 5 uses pseudo-db source-link only. Users whose target file isn't in the pseudo-db get "Definition not found".
- **Full right-click context menu.** Right-click currently fires Go-to-Definition directly. A menu with multiple options (Find References, Rename, etc.) is a future enhancement.
- **Forward navigation history.** Only back is supported in Phase 5. Phase 6+ could add Cmd+Shift+- / Cmd+Shift+= for back/forward.
- **Cross-session nav history.** History clears on session switch. No persistence.
- **Semantic / embedding search** in Global Search. FTS only.
- **Quick-open by filename** in Global Search. Only content search. A filename mode could be added with a `@` prefix syntax later.
- **Global Search for non-linked files.** If a search hits a pseudo file whose source isn't linked, Global Search offers to link it via the same dialog — but there's no "browse all project files" mode.
- **Auto-detect language for linked files from the source path.** Phase 3 already covers this via `computeSourceMeta.language`.
- **Settings for the Cmd+K shortcut.** Hardcoded cmd/ctrl+K.

---

## 5. Validation

At the end of Phase 5 the following must work:

1. **Cmd+click a function name** in a linked TS file → resolver calls source-link → one linked candidate → editor jumps to that function in the linked file. Nav history back button becomes enabled.
2. **Right-click a function name** → same flow as cmd+click.
3. **Cmd+click an unlinked target** → LinkAndNavigateDialog appears asking to link. On confirm, the file is linked, focused, and the editor jumps to the correct line.
4. **Cmd+click a symbol with multiple definitions** → DefinitionPickerPopover shows a list → click one → navigate.
5. **Cmd+click on punctuation / keyword** → silent no-op.
6. **Back button in toolbar** → disabled initially → becomes enabled after a cross-file jump → clicking goes back to the previous location.
7. **Cmd+K opens GlobalSearch** from anywhere in the app.
8. **Search query returns pseudo + code results** — pseudo hits show file path, method name, snippet with match highlight; code hits show snippet id basename, line number, context excerpt.
9. **Click a code-kind result** → jumps directly to that linked snippet + line.
10. **Click a pseudo-kind result** whose file is NOT linked → LinkAndNavigateDialog offers to link. On confirm → link + jump.
11. **Phase 4 features still work:** plain click still opens references popover, function jump dropdown still works, cmd-click does NOT fire the references popover (only Go-to-Definition).
12. **Tests green:** backend code-search tests, definition-resolver unit tests, useNavHistory unit tests.
13. **No regressions** in Phases 1-4.

---

## 6. Risks + Mitigation

### Event conflict — cmd-click firing both handlers
**Risk:** Phase 4's `onSymbolClick` was installed on `click`, which also fires for cmd-click. The references popover would pop up alongside Go-to-Definition.
**Mitigation:** Phase 5 modifies the existing `click` handler to short-circuit when `metaKey || ctrlKey` is held. Documented explicitly in task `ui-codemirror-go-to-def`.

### pendingJump race conditions
**Risk:** if a user cmd-clicks rapidly across multiple files, the pending jump might get consumed by the wrong editor instance, or lost if the new editor mounts before the store is updated.
**Mitigation:** use a zustand store so the setter is synchronous, and consume() checks the snippetId match. Order: setPending BEFORE selectSnippet, so by the time the new CodeEditor mounts and its effect runs, the pending value is already available to consume. Rapid clicks overwrite the pending value — last one wins, which is the expected behavior.

### Definition resolution for ambiguous matches
**Risk:** overloaded methods in C# or multiple functions with the same name in different files. Phase 3's scanner grabbed "first match wins" for source_line, so Phase 5's picker may show duplicates.
**Mitigation:** `resolveDefinition` returns a picker when there are multiple candidates with different paths. Within a single file, overloaded methods collapse to one row. Good-effort — a user-facing toast can say "multiple matches" if this proves confusing.

### Backend code grep perf
**Risk:** substring-grepping every linked snippet on every keystroke of the search input = slow on sessions with many large linked files.
**Mitigation:** debounce the UI fetch 200ms. Backend caps content size per snippet at 1MB (same as the link threshold). Results capped at 100 total. For truly large sessions, add a future enhancement to cache content hashes and only grep changed files.

### GlobalSearch mounting location
**Risk:** App.tsx may not be the right host — some layouts wrap everything in providers. The implementer should Grep for App.tsx, check what it renders, and pick the right mount point (typically right after the store providers but inside any router).
**Mitigation:** Task description instructs the implementer to verify via Grep before editing.

### Back button semantics
**Risk:** confusing UX if back "jumps" to a location the user didn't explicitly visit (e.g., a jump from the function dropdown in Phase 4).
**Mitigation:** in Phase 5, only cross-file jumps push onto the history stack. Same-file jumps (dropdown / references popover) don't. Documented in task `ui-codeeditor-feature-b`.

---

## 7. Implementation Notes

- **SourceLinkCandidate type location:** Phase 3 exported it from `src/services/pseudo-db.ts`. Phase 5 should add a matching UI type in `ui/src/lib/pseudo-api.ts` so the UI doesn't reach into backend types.
- **linkedSnippets source:** use `useSessionStore((s) => s.snippets)` and filter for linked envelopes. Mirror the filter logic from `Sidebar.tsx`:
  ```typescript
  const linkedSnippets = useMemo(() => {
    return snippets
      .map(s => {
        try { return { id: s.id, filePath: JSON.parse(s.content).filePath }; }
        catch { return null; }
      })
      .filter((s): s is { id: string; filePath: string } => !!s?.filePath);
  }, [snippets]);
  ```
- **Linking flow reuse:** `handleLinkFile` in Sidebar.tsx lines 327-351 is the reference — `api.createSnippet` + `api.syncCodeFromDisk`. Phase 5 should extract this into a shared utility `ui/src/lib/link-file.ts` so both CodeEditor's Feature B and GlobalSearch's pseudo-kind result click can use it. But the migration plan doesn't require extraction — each task can inline the same pattern. Decision: DO extract into `ui/src/lib/link-file.ts` in the `ui-api-extensions` task since it's a one-function lib helper.
- **Toolbar Back button placement:** in `mergedControls`, put the back button FIRST (leftmost) so it's always in the same spot. Disable state when `!canGoBack`.
- **Keyboard shortcut for global search:** listen on `document` with `keydown` + `(e.metaKey || e.ctrlKey) && e.key === 'k'`. Preventing default is important so it doesn't trigger browser's location bar.
