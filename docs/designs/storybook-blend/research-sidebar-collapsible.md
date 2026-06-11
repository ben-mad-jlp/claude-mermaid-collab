# Research: Sidebar Collapsible Sections Pattern

## Relevant Files

| File | Purpose |
|------|---------|
| `ui/src/components/layout/Sidebar.tsx` | Main sidebar — renders Tasks, Blueprints, and Items sections |
| `ui/src/components/editors/CollapsibleSection.tsx` | Reusable collapsible for markdown editor headings (NOT used in sidebar) |
| `ui/src/components/editors/CollapsibleDetails.tsx` | Reusable `<details>`-style collapsible (NOT used in sidebar) |
| `ui/src/stores/sessionStore.ts` | Zustand store — holds all selection state and data |
| `ui/src/types/session.ts` | `CollabState` type with `batches` array |
| `ui/src/types/document.ts` | `Document` type with `blueprint?: boolean` flag |

## How Collapsible Sections Work in the Sidebar

The sidebar does **NOT** use `CollapsibleSection` or `CollapsibleDetails`. Those components are for the markdown editor content area. Instead, the sidebar uses a simple **inline pattern** with local `useState` booleans.

### Pattern: Local boolean state + inline chevron button

```tsx
// State declaration (line 93-94)
const [blueprintCollapsed, setBlueprintCollapsed] = useState(false);
const [tasksCollapsed, setTasksCollapsed] = useState(false);

// Section rendering pattern (Tasks example, lines 436-492):
{conditionToShow && (
  <div className="border-b border-gray-200 dark:border-gray-700">
    {/* Header button — toggles collapsed state */}
    <button
      onClick={() => setTasksCollapsed((c) => !c)}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <span>Tasks</span>
      <svg
        className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${tasksCollapsed ? '-rotate-90' : ''}`}
        viewBox="0 0 20 20" fill="currentColor"
      >
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
    {/* Content — conditionally rendered */}
    {!tasksCollapsed && (
      <div className="space-y-1 px-2 pb-2">
        {/* Child items here */}
      </div>
    )}
  </div>
)}
```

### Key Design Details

- **Chevron rotation:** Down arrow (default) rotates to `-rotate-90` (pointing right) when collapsed
- **No animation on content:** Content is toggled via conditional render (`{!collapsed && ...}`), not animated height
- **Section header styling:** `text-xs font-semibold` — smaller than item text
- **Border:** Each section wrapped in `border-b` div for visual separation
- **Item count badge:** Blueprints section shows count: `<span className="ml-1 text-gray-400">{blueprintItems.length}</span>`

## Tasks Section Specifics

- **Visibility condition:** `isImplementationPhase && !isDisabled` where `isImplementationPhase = hasBatches && hasActiveBlueprints`
  - `hasBatches` = `collabState?.batches?.length > 0`
  - `hasActiveBlueprints` = `blueprintItems.length > 0`
- **Contains two hardcoded items:**
  1. "Task Graph" — calls `selectTaskGraph()` which sets `taskGraphSelected: true` and clears all other selections
  2. "Task Details" — a document named `task-graph`, clicked via `handleItemClick()` (same as regular documents)
- **Selection highlight:** Uses same accent classes as all items: `bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300`

## Blueprints Section Specifics

- **Visibility condition:** `blueprintItems.length > 0 && !isDisabled && !todosSelected`
- **Data source:** Filters `documents` array for `d.blueprint === true` (excluding vibeinstructions), sorted by `lastModified` desc
- **Items are dynamic:** Maps over `blueprintItems` array, each rendered as a button
- **Click behavior:** Same `handleItemClick()` as regular document items — calls `selectDocumentWithContent()`
- **Icon:** Book icon (open book SVG)

## Items Section (for comparison)

- The main "Items" list excludes blueprint docs and task-graph: `documents.filter(d => !d.blueprint && d.name !== 'task-graph')`
- Uses `ItemCard` component (not inline buttons)
- Has search, deprecated filter, pin/delete actions

## Click Behavior Summary

| Sidebar Item | Click Handler | Store Action |
|---|---|---|
| Task Graph (special) | `selectTaskGraph()` | Sets `taskGraphSelected: true`, clears all other IDs |
| Task Details doc | `handleItemClick()` | `selectDocumentWithContent()` — fetches content, sets `selectedDocumentId` |
| Blueprint doc | `handleItemClick()` | `selectDocumentWithContent()` — same as above |
| Regular item | `handleItemClick()` | Routes by type: `selectDiagramWithContent`, `selectDocumentWithContent`, etc. |

## What to Add/Modify for an "Embeds" Section

### 1. State in Sidebar.tsx
```tsx
const [embedsCollapsed, setEmbedsCollapsed] = useState(false);
```

### 2. Data — compute embed items
Depends on how embeds are stored. If they are a filtered subset of existing types (like blueprints are filtered documents), add a `useMemo`:
```tsx
const embedItems = useMemo(() => {
  // Filter/compute embed items from store data
  return items.filter(/* embed criteria */);
}, [/* dependencies */]);
```

### 3. JSX — insert between Blueprints and Items sections (around line 537)
Follow the exact same pattern: outer `div` with `border-b`, header `button` with chevron, conditional content `div`.

### 4. Store changes (if embeds need their own selection state)
- Add `embedsSelected` boolean or `selectedEmbedId` to store if embeds open a different view
- Or reuse existing selection if embeds are just diagrams/documents with an embed flag

### 5. Filtering — exclude embeds from main Items list
Same pattern as blueprints: add a filter condition in the `filteredItems` useMemo to exclude embed items from the general list.

## Section Rendering Order in Sidebar

1. Todo controls (when `todosSelected`)
2. Vibe Instructions (pinned document)
3. **Tasks** (collapsible, when `isImplementationPhase`)
4. **Blueprints** (collapsible, when blueprint docs exist)
5. **[Embeds would go here]**
6. **Items** (scrollable list with search)
