# Blueprint: Pseudo UI Migration to Structured Data

## 1. Structure Summary

### Files and Roles

| File | Role | Key Change |
|------|------|------------|
| `ui/src/lib/pseudo-api.ts` | API client + shared types | Add `PseudoFileSummary`, `PseudoFileWithMethods`, `PseudoMethod` types; change `fetchPseudoFile` return from `string` to `PseudoFileWithMethods` |
| `ui/src/pages/pseudo/PseudoViewer.tsx` | Center panel viewer | Remove `parsePseudo` import; consume `PseudoFileWithMethods` directly instead of raw string |
| `ui/src/pages/pseudo/PseudoBlock.tsx` | Single function block renderer | Replace `ParsedFunction` with `PseudoMethod`; render from `steps[]` instead of `body[]` |
| `ui/src/pages/pseudo/CallsPopover.tsx` | Hover popover for CALLS links | Remove `parsePseudo`; accept structured data or fetch structured endpoint |
| `ui/src/pages/pseudo/CallsLink.tsx` | Clickable call reference link | Pass structured data to popover instead of raw text |
| `ui/src/pages/pseudo/FunctionJumpPanel.tsx` | Right panel function list | Replace `ParsedFunction` with `PseudoMethod` type |
| `ui/src/pages/pseudo/PseudoFileTree.tsx` | Left sidebar file tree | Accept `PseudoFileSummary[]` instead of `string[]`; add method/export count badges |
| `ui/src/pages/pseudo/PseudoSearch.tsx` | Cmd+K search overlay | Full rewrite — types already match server, but clean up flat result handling |
| `ui/src/pages/pseudo/PseudoPage.tsx` | Top-level state owner | Update `PseudoPageState` types; delete `fileCache`; replace `ParsedFunction[]` with `PseudoMethod[]` |
| `ui/src/pages/pseudo/parsePseudo.ts` | Client-side parser | DELETE — no longer needed |
| `ui/src/pages/pseudo/parsePseudo.test.ts` | Parser tests | DELETE — no longer needed |

### Backend Response Shapes (from `src/services/pseudo-db.ts`)

**GET /api/pseudo/files** returns `{ files: PseudoFileSummary[] }`:
```ts
{ filePath: string; title: string; methodCount: number; exportCount: number; lastUpdated: string }
```

**GET /api/pseudo/file** returns `PseudoFileWithMethods`:
```ts
{
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  syncedAt: string | null;
  methods: Array<{
    name: string;
    params: string;
    returnType: string;
    isExported: boolean;
    date: string | null;
    steps: Array<{ content: string; depth: number }>;
    calls: Array<{ name: string; fileStem: string }>;
  }>;
}
```

### Current Import Graph (what depends on parsePseudo)
- `PseudoViewer.tsx` — imports `parsePseudo`
- `PseudoBlock.tsx` — imports `ParsedFunction` type
- `CallsPopover.tsx` — imports `parsePseudo`
- `FunctionJumpPanel.tsx` — imports `ParsedFunction` type
- `PseudoPage.tsx` — imports `ParsedFunction` type

---

## 2. Function Blueprints

### 2.1 pseudo-api.ts — New Types + Updated Fetch

```
ADD TYPE PseudoFileSummary:
  filePath: string
  title: string
  methodCount: number
  exportCount: number
  lastUpdated: string

ADD TYPE PseudoMethod:
  name: string
  params: string
  returnType: string
  isExported: boolean
  date: string | null
  steps: Array<{ content: string; depth: number }>
  calls: Array<{ name: string; fileStem: string }>

ADD TYPE PseudoFileWithMethods:
  filePath: string
  title: string
  purpose: string
  moduleContext: string
  syncedAt: string | null
  methods: PseudoMethod[]

UPDATE fetchPseudoFiles:
  CHANGE return type: string[] → PseudoFileSummary[]
  REMOVE the .map() that extracts filePath strings
  RETURN data.files as PseudoFileSummary[]

UPDATE fetchPseudoFile:
  CHANGE return type: string → PseudoFileWithMethods
  REMOVE data.content extraction
  RETURN data as PseudoFileWithMethods (the endpoint already returns the full object)

KEEP fetchPseudoReferences unchanged (already returns Reference[])
KEEP searchPseudo unchanged (already returns SearchResult[])

REMOVE old CallsRef type (now lives in PseudoMethod.calls inline)
```

### 2.2 PseudoViewer.tsx — Remove Parsing

```
REMOVE import of parsePseudo
ADD import of PseudoFileWithMethods, PseudoMethod from pseudo-api

REPLACE state:
  OLD: content: string
  NEW: file: PseudoFileWithMethods | null

REPLACE loadFile effect:
  OLD: fileContent = await fetchPseudoFile(project, path) → setContent(fileContent)
  NEW: fileData = await fetchPseudoFile(project, path) → setFile(fileData)

DELETE: const parsed = useMemo(() => parsePseudo(content), [content])

UPDATE onFunctionsChange callback:
  OLD: onFunctionsChange(parsed.functions)
  NEW: onFunctionsChange(file.methods)

UPDATE render — header:
  OLD: parsed.syncedAt, parsed.titleLine, parsed.subtitleLine, parsed.moduleProse
  NEW: file.syncedAt, file.title, file.purpose, file.moduleContext

UPDATE render — function list:
  OLD: parsed.functions.map(func => <PseudoBlock func={func} .../>)
  NEW: file.methods.map(method => <PseudoBlock method={method} .../>)

UPDATE PseudoViewerProps.onFunctionsChange:
  OLD: (functions: any[]) => void
  NEW: (methods: PseudoMethod[]) => void
```

### 2.3 PseudoBlock.tsx — Render from Steps

```
REMOVE import of ParsedFunction from parsePseudo
ADD import of PseudoMethod from pseudo-api

UPDATE PseudoBlockProps:
  OLD: func: ParsedFunction
  NEW: method: PseudoMethod

UPDATE header render:
  OLD: func.name, func.params, func.returnType, func.isExport, func.updatedAt
  NEW: method.name, method.params, method.returnType, method.isExported, method.date

UPDATE CALLS section:
  OLD: func.calls (CallsRef[])
  NEW: method.calls (same shape, no change needed)

REPLACE body render:
  OLD: func.body.map((line, idx) => renderBodyLine(line, idx))
       renderBodyLine parses indentation from leading spaces
  NEW: method.steps.map((step, idx) => renderStep(step, idx))
       renderStep uses step.depth for indentation (paddingLeft = 20 + step.depth * 16)
       renderStep applies tokenizeLine to step.content

UPDATE data-function attribute:
  OLD: data-function={func.name}
  NEW: data-function={method.name}

KEEP tokenizeLine helper unchanged
KEEP KEYWORD_PATTERN unchanged
```

### 2.4 CallsPopover.tsx — Remove parsePseudo

```
REMOVE import of parsePseudo
ADD import of PseudoFileWithMethods, fetchPseudoFile from pseudo-api

UPDATE CallsPopoverProps:
  OLD: content?: string (raw pseudo text)
  NEW: content?: string (kept for backward compat during transition)
  ADD: fileData?: PseudoFileWithMethods (structured data)

UPDATE internal parsing:
  OLD: const parsed = useMemo(() => parsePseudo(content), [content])
  NEW: use fileData directly when available; if only content string provided, skip

UPDATE exported functions extraction:
  OLD: parsed.functions.filter(fn => fn.isExport)
  NEW: fileData.methods.filter(m => m.isExported)

UPDATE title/subtitle display:
  OLD: parsed.titleLine, parsed.subtitleLine
  NEW: fileData.title, fileData.purpose
```

### 2.5 CallsLink.tsx — Pass Structured Data to Popover

```
UPDATE handleMouseEnter:
  OLD: content = await fetchPseudoFile(project, fileStem) → string
  NEW: fileData = await fetchPseudoFile(project, fileStem) → PseudoFileWithMethods

UPDATE popoverState type:
  OLD: { visible, anchorRect, content?: string }
  NEW: { visible, anchorRect, fileData?: PseudoFileWithMethods }

UPDATE CallsPopover render:
  OLD: <CallsPopover content={popoverState.content} .../>
  NEW: <CallsPopover fileData={popoverState.fileData} .../>
```

### 2.6 FunctionJumpPanel.tsx — Type Swap

```
REMOVE import of ParsedFunction from parsePseudo
ADD import of PseudoMethod from pseudo-api

UPDATE FunctionJumpPanelProps:
  OLD: functions: ParsedFunction[]
  NEW: functions: PseudoMethod[]

UPDATE export dot render:
  OLD: func.isExport
  NEW: func.isExported
```

### 2.7 PseudoFileTree.tsx — Accept Summaries + Badges

```
UPDATE PseudoFileTreeProps:
  OLD: fileList: string[]
  NEW: fileList: PseudoFileSummary[]

UPDATE buildTree call:
  OLD: buildTree(fileList) — expects string[]
  NEW: buildTree(fileList.map(f => f.filePath)) — extract paths
  OR: update buildTree to accept PseudoFileSummary[] and attach metadata to TreeNode

ADD badge rendering in TreeNodeRenderer (for leaf nodes):
  Show methodCount and exportCount from summary data
  Format: "3 fn · 1 exp" next to file name

UPDATE onNavigate:
  Still passes file stem string (extracted from filePath)
```

### 2.8 PseudoSearch.tsx — Full Rewrite

```
KEEP PseudoSearchProps unchanged (project, isOpen, onClose, onNavigate)
KEEP SearchResult and SearchMatch types from pseudo-api (already correct)

REWRITE internal state:
  Replace class-based debounce with useDeferredValue or keep setTimeout
  Simplify flatResults — current implementation is correct

REWRITE result rendering:
  Clean up grouped display
  Ensure function names link correctly with new file stems

No type changes needed — search endpoint returns same shape
Focus: code quality, remove dead code paths
```

### 2.9 PseudoPage.tsx — State Type Updates

```
REMOVE import of ParsedFunction from parsePseudo
ADD import of PseudoMethod, PseudoFileSummary from pseudo-api

UPDATE PseudoPageState:
  OLD: fileList: string[]; fileCache: Map<string, string>
  NEW: fileList: PseudoFileSummary[]
  DELETE: fileCache (no longer needed — viewer fetches structured data)

UPDATE state declarations:
  OLD: const [fileList, setFileList] = useState<string[]>([])
  NEW: const [fileList, setFileList] = useState<PseudoFileSummary[]>([])
  DELETE: const [fileCache] = useState<Map<string, string>>(new Map())

UPDATE functions state:
  OLD: const [functions, setFunctions] = useState<ParsedFunction[]>([])
  NEW: const [functions, setFunctions] = useState<PseudoMethod[]>([])

UPDATE loadPseudoFiles:
  OLD: fetchPseudoFiles returns string[]
  NEW: fetchPseudoFiles returns PseudoFileSummary[] (no code change needed after api update)

UPDATE PseudoFileTree prop:
  OLD: fileList={fileList} (string[])
  NEW: fileList={fileList} (PseudoFileSummary[] — type change flows through)

DELETE: fileCache.clear() in project-change effect
```

### 2.10 Delete parsePseudo.ts + parsePseudo.test.ts

```
DELETE ui/src/pages/pseudo/parsePseudo.ts
DELETE ui/src/pages/pseudo/parsePseudo.test.ts

Verify: no remaining imports of parsePseudo across codebase
```

### 2.11 Test File Updates

```
Files to update:
  - PseudoBlock.test.tsx — replace ParsedFunction fixtures with PseudoMethod
  - CallsPopover.test.tsx — replace raw text content with PseudoFileWithMethods
  - FunctionJumpPanel.test.tsx — replace ParsedFunction fixtures with PseudoMethod
  - PseudoPage.test.tsx — update mock fetchPseudoFiles to return PseudoFileSummary[]
  - CallsLink.test.tsx — update mock fetchPseudoFile to return PseudoFileWithMethods
  - PseudoSearch.test.tsx — no type changes, but review for consistency
  - PseudoFileTree.test.tsx — update fileList fixtures from string[] to PseudoFileSummary[]

Key fixture changes:
  ParsedFunction → PseudoMethod:
    isExport → isExported
    updatedAt → date
    body: string[] → steps: Array<{ content, depth }>
    calls stays the same shape

  PseudoFileSummary[] replaces string[]:
    OLD: ["api.pseudo", "auth.pseudo"]
    NEW: [{ filePath: "api.pseudo", title: "API", methodCount: 3, exportCount: 1, lastUpdated: "2026-01-01" }, ...]
```

---

## 3. Task Dependency Graph

```yaml
tasks:
  - id: pseudo-api-types
    files: [ui/src/lib/pseudo-api.ts]
    tests: []
    description: "Add PseudoFileSummary, PseudoMethod, PseudoFileWithMethods types. Update fetchPseudoFiles return to PseudoFileSummary[]. Update fetchPseudoFile return to PseudoFileWithMethods. Remove old string-extraction logic."
    parallel: true
    depends-on: []

  - id: pseudo-viewer
    files: [ui/src/pages/pseudo/PseudoViewer.tsx]
    tests: []
    description: "Remove parsePseudo import. Replace content:string state with file:PseudoFileWithMethods|null. Read title/purpose/syncedAt/methods directly. Pass methods to onFunctionsChange."
    parallel: false
    depends-on: [pseudo-api-types]

  - id: pseudo-block
    files: [ui/src/pages/pseudo/PseudoBlock.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Replace body[].map(renderBodyLine) with steps[].map(renderStep). Use step.depth for indentation. Rename isExport→isExported, updatedAt→date."
    parallel: true
    depends-on: [pseudo-api-types]

  - id: calls-popover
    files: [ui/src/pages/pseudo/CallsPopover.tsx]
    tests: []
    description: "Remove parsePseudo import. Change content prop to fileData:PseudoFileWithMethods. Read title/purpose/exports directly from structured data."
    parallel: true
    depends-on: [pseudo-api-types]

  - id: function-jump-panel
    files: [ui/src/pages/pseudo/FunctionJumpPanel.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Update isExport→isExported in export dot render."
    parallel: true
    depends-on: [pseudo-api-types]

  - id: pseudo-file-tree
    files: [ui/src/pages/pseudo/PseudoFileTree.tsx]
    tests: []
    description: "Change fileList prop from string[] to PseudoFileSummary[]. Extract filePath for buildTree. Add method/export count badges on leaf nodes."
    parallel: true
    depends-on: [pseudo-api-types]

  - id: pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.tsx]
    tests: []
    description: "Full rewrite for code quality. Clean up flat result handling, remove dead code paths."
    parallel: true
    depends-on: [pseudo-api-types]

  - id: calls-link
    files: [ui/src/pages/pseudo/CallsLink.tsx]
    tests: []
    description: "Update fetchPseudoFile call (returns PseudoFileWithMethods). Change popoverState.content to fileData. Pass fileData prop to CallsPopover."
    parallel: false
    depends-on: [calls-popover]

  - id: pseudo-page
    files: [ui/src/pages/pseudo/PseudoPage.tsx]
    tests: []
    description: "Replace ParsedFunction with PseudoMethod. Replace string[] with PseudoFileSummary[] for fileList. Delete fileCache state. Update child component props."
    parallel: false
    depends-on: [pseudo-viewer, pseudo-block, pseudo-file-tree, function-jump-panel, calls-link, pseudo-search]

  - id: delete-parse-pseudo
    files: [ui/src/pages/pseudo/parsePseudo.ts]
    tests: [ui/src/pages/pseudo/parsePseudo.test.ts]
    description: "Delete parsePseudo.ts and parsePseudo.test.ts. Verify no remaining imports across codebase."
    parallel: false
    depends-on: [pseudo-page]

  - id: test-pseudo-block
    files: [ui/src/pages/pseudo/PseudoBlock.test.tsx]
    tests: []
    description: "Replace ParsedFunction fixtures with PseudoMethod. Change isExport→isExported, updatedAt→date, body→steps."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-calls-popover
    files: [ui/src/pages/pseudo/CallsPopover.test.tsx]
    tests: []
    description: "Replace raw text content with PseudoFileWithMethods objects. Update prop names from content to fileData."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-calls-link
    files: [ui/src/pages/pseudo/CallsLink.test.tsx]
    tests: []
    description: "Update mock fetchPseudoFile to return PseudoFileWithMethods instead of raw string."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-function-jump-panel
    files: [ui/src/pages/pseudo/FunctionJumpPanel.test.tsx]
    tests: []
    description: "Replace ParsedFunction fixtures with PseudoMethod. Update isExport→isExported."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-pseudo-page
    files: [ui/src/pages/pseudo/PseudoPage.test.tsx]
    tests: []
    description: "Update mock fetchPseudoFiles to return PseudoFileSummary[]. Update mock fetchPseudoFile to return PseudoFileWithMethods."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-pseudo-file-tree
    files: [ui/src/pages/pseudo/PseudoFileTree.test.tsx]
    tests: []
    description: "Change fileList fixtures from string[] to PseudoFileSummary[]. Verify badge rendering."
    parallel: true
    depends-on: [delete-parse-pseudo]

  - id: test-pseudo-search
    files: [ui/src/pages/pseudo/PseudoSearch.test.tsx]
    tests: []
    description: "Review for consistency with rewritten component. May need DOM query updates."
    parallel: true
    depends-on: [delete-parse-pseudo]
```
