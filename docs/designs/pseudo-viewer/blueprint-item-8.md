# Blueprint: Item 8 - PseudoSearch

## 1. Structure Summary

### Files
- [ ] `ui/src/pages/pseudo/PseudoSearch.tsx` — Cmd+K search with dropdown results

### Type Definitions

```typescript
type PseudoSearchProps = {
  project: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (stem: string, functionName?: string) => void;
}

type SearchResultEntry = {
  fileIndex: number;
  matchIndex: number;
  file: string;
  match: { function: string; line: string; lineNumber: number };
}
```

### Component Interactions
- `PseudoPage` controls `isOpen` (set true on Cmd+K)
- `PseudoSearch` calls `searchPseudo` from `pseudo-api.ts`
- On result select: calls `onNavigate(stem, functionName)` → PseudoPage navigates and calls `viewerRef.current.scrollToFunction`

---

## 2. Function Blueprints

### `PseudoSearch(props: PseudoSearchProps): JSX.Element | null` (EXPORT default)

**Pseudocode:**
1. State: `query`, `results: SearchResult[]`, `highlighted` (flat index into result entries)
2. `debounceTimer` ref
3. On `isOpen` change to true: focus input
4. On `query` change:
   a. Clear debounce timer
   b. If query empty → clear results
   c. Else → 200ms timer → call `searchPseudo(project, query)` → set results (max 8 files × 3 matches)
5. Keyboard handler on input:
   - `ArrowDown/Up`: move `highlighted` index through flat entries list
   - `Enter`: call `selectEntry(highlighted)`
   - `Esc`: `onClose()`
6. `selectEntry(index)`:
   a. Find file stem + function name from flat index
   b. Call `onNavigate(stem, functionName)`
   c. After `setTimeout(0)`: `viewerRef.current?.scrollToFunction(functionName)` — but viewerRef not directly accessible; instead `onNavigate` should handle this
   d. Call `onClose()`
7. Global mousedown: if click outside search box → `onClose()`
8. Render (only when `isOpen`):
   - Semi-transparent overlay
   - Centered search box: input + dropdown below
   - Dropdown: groups by file (muted path header + up to 3 match lines)
   - Each match: function sig (truncated 60 chars)
   - Highlighted entry: `bg-purple-50`
   - Empty results: "No results for 'query'"

**Error Handling:** Search API error → clear results, show no error to user (silent fail).

**Stub:**
```typescript
export default function PseudoSearch({ project, isOpen, onClose, onNavigate }: PseudoSearchProps): JSX.Element | null {
  // TODO: query, results, highlighted state
  // TODO: 200ms debounce → searchPseudo
  // TODO: keyboard: ArrowDown/Up/Enter/Esc
  // TODO: global mousedown → close
  // TODO: grouped dropdown render
  if (!isOpen) return null;
  throw new Error('Not implemented');
}
```

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.tsx]
    tests: [ui/src/pages/pseudo/PseudoSearch.test.tsx]
    description: "Cmd+K search with 200ms debounce, grouped dropdown, keyboard navigation"
    parallel: true
    depends-on: []
```

### Execution Waves

**Wave 1 (parallel):**
- pseudo-search

### Mermaid Visualization

```mermaid
graph TD
    pseudo-search[pseudo-search]
    style pseudo-search fill:#c8e6c9
```

### Summary
- Total tasks: 1
- Total waves: 1
- Max parallelism: 1
