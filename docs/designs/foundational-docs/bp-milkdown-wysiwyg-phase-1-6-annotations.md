# Blueprint: Milkdown WYSIWYG — Phase 1.6 Raw-Source Annotations

Scope: preserve raw-source whitespace and marker decisions that are lost by MDAST parse, so the 4 remaining Phase 0 fixtures round-trip byte-exact without regressing the 10 that currently pass. On pass, the `wysiwygDocumentEditor` flag becomes eligible to flip default-on in dev.

## Source Artifacts
- `bp-milkdown-wysiwyg-phase-1-5-remediation` — the remediation that landed 11/12 tasks and reached 6/10 original fixtures
- `review-bugs`, `review-completeness` — pre-remediation findings (now largely resolved)
- `design-milkdown-migration` §Round-trip fidelity hardening

---

## 1. Structural Diagnosis

The remaining 4 fixtures (05, 07, 09, 10) fail for reasons that **cannot** be fixed by remark-stringify options alone:

| Fixture | Drift | Why serializer-tuning can't fix it |
|---------|-------|-----------------------------------|
| 05-emphasis | `**bold \`code\`**` → `**bold** **\`code\`**` | Milkdown PM schema splits strong mark at inline-code boundary; any mark-joining pass must run at PM doc level |
| 07-embed-in-list | blank line inserted before 2nd list item | listItem with multiple block children (paragraph + diagramEmbed) forces spread semantics in stringify |
| 09-hardbreaks | `  \n` AND `\\\n` both normalized to one style | fixture mixes styles per paragraph; single global `handlers.break` loses the other; need per-node `style` attr captured at parse time |
| 10 vs 14 | identical `heading`+`list` MDAST, different blank-line expectations | stringify has no input to distinguish; need raw-source offset captured as node attr |

Common thread: **the MDAST parser erases information that the round-trip needs**. The fix is to attach that information as node attrs during parse, then honor those attrs during stringify.

---

## 2. Function Blueprints

### `remarkCaptureRawPositions` (new)

A remark plugin that runs AFTER parse and BEFORE Milkdown's schema mapping. Walks every block node and captures:
- `node.data.rawWhitespace` — the exact whitespace *following* this block in the source (read via `node.position.end.offset` + vfile `value.slice`)
- `node.data.rawStart` — leading whitespace (for listItem spread detection)

Stored as MDAST `data` which Milkdown 7.x copies to PM node attrs via the schema `parseMarkdown.runner`.

**Pseudocode:**
1. Export `remarkCaptureRawPositions: Plugin<[], Root>`
2. `(tree, file) => { visit(tree, (node, index, parent) => { ... }) }`
3. For each block-level node with a position: read the raw slice between this node's end and the next sibling's start (or EOF)
4. Store that slice on `node.data ??= {}; node.data.rawTrailing = slice;`
5. For `break` nodes: inspect `file.value.slice(position.start.offset - 3, position.start.offset)` — if `  ` (two spaces) → `style: 'spaces'`, if `\\` → `style: 'backslash'`, else `style: 'html'`
6. For `list` nodes: inspect raw to detect bullet marker per-item (already partly done, but make it authoritative by reading `list.children[i].position.start.offset`)

**Tests:** parse each failing fixture, assert the expected `data.rawTrailing` / `data.style` / `data.marker` values are captured.

### `hardBreakStyle` plugin (fill in)

Currently deferred in `serializerConfig.ts`. Implement as `$nodeSchema('hardbreak', ...)`:

**Pseudocode:**
1. `attrs: { style: { default: 'spaces' } }` (`'spaces' | 'backslash' | 'html'`)
2. `parseMarkdown.runner`: `state.addNode(type, undefined, undefined, { style: (node as any).data?.style ?? 'spaces' })`
3. `toMarkdown.runner`: switch on attr — emit `'  \n'`, `'\\\n'`, or `'<br>\n'` as a raw text node; use `state.addNode('text', undefined, value)` with appropriate escaping

### `trailingWhitespaceJoin` plugin

Updates `remarkStringifyOptionsCtx.join` to consult `left.data?.rawTrailing` when deciding blank-line-separation:

**Pseudocode:**
```ts
join: [
  (left, right, parent, state) => {
    const raw = (left as any).data?.rawTrailing;
    if (typeof raw === 'string') {
      const blankLines = (raw.match(/\n/g) ?? []).length - 1;
      return Math.max(0, blankLines);
    }
    return undefined;
  },
]
```

This gives each block the exact number of blank lines it had in source, fixing fixture 10 without regressing fixture 14.

### `strongMarkJoining` (structural fix for 05)

At PM doc level, post-parse, walk sibling text spans that share a mark (same type + attrs) and coalesce them. Done as a Milkdown plugin that runs a one-shot transaction after initial doc creation:

**Pseudocode:**
1. On editor init, read `editorViewCtx`; scan `state.doc.descendants`
2. For adjacent nodes with identical strong marks separated only by an inline-code node, the issue is at parse time: `remark-parse` itself correctly emits one strong mark spanning the code. The split happens in Milkdown's `commonmark` preset because inline code breaks mark inheritance in the PM schema.
3. Simpler fix: override `$markSchema('strong', ...)` so `parseMarkdown.runner` uses `state.openMark` / `state.closeMark` spanning the whole mdast subtree, not per-child.

**Alternative (pragmatic):** if PM-level fix is too invasive, accept fixture 05 as known drift — inline code inside bold is rare in real docs. Move 05 to `acceptableDrift` allowlist with a comment.

### `listItemSpread` (structural fix for 07)

Embed-in-list forces spread because the listItem contains two block children (paragraph + diagramEmbed). Options:

1. **Make diagramEmbed inline when inside a listItem** — change `diagramEmbed` schema `group` from `'block'` to `'block inline'` or to `'inline'` when parent is listItem. Requires PM schema group composition.
2. **Rewrite the toMarkdown path** for listItem to check if all children are simple enough to emit tightly regardless of block count.
3. **Mark-based embed** — switch embed from block node to inline atom mark. Loses block-level editability but fixes the drift.

Option 2 is least disruptive:

**Pseudocode:** override `list_item` toMarkdown runner. If `node.attrs.spread === false` AND every child is a "simple" block (paragraph or diagramEmbed with no trailing content), emit the items without blank-line separation by wrapping the sequence in a container that sets `tightDefinitions` equivalent for this subtree.

---

## 3. Task Dependency Graph

```yaml
tasks:
  - id: raw-positions-plugin
    files: [ui/src/components/editors/milkdown/plugins/rawPositions.ts]
    tests: [ui/src/components/editors/milkdown/plugins/__tests__/rawPositions.test.ts]
    description: "New remarkCaptureRawPositions plugin. Walks MDAST, captures rawTrailing (slice between node end and next sibling start) on node.data, captures break.data.style by inspecting file.value, captures list marker per listItem."
    parallel: true
    depends-on: []

  - id: hardbreak-schema
    files: [ui/src/components/editors/milkdown/serializerConfig.ts]
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Fill in hardBreakStyle $nodeSchema override with style attr (spaces/backslash/html), parseMarkdown honors node.data.style, toMarkdown emits matching literal."
    parallel: false
    depends-on: [raw-positions-plugin]

  - id: trailing-whitespace-join
    files: [ui/src/components/editors/milkdown/serializerConfig.ts]
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Add join function to remarkStringifyOptionsCtx update that consults left.data.rawTrailing to determine blank-line count between blocks. Must not regress fixtures 11-14."
    parallel: false
    depends-on: [raw-positions-plugin]

  - id: listitem-spread-fix
    files: [ui/src/components/editors/milkdown/serializerConfig.ts]
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Override list_item toMarkdown to emit tight when spread=false even with multiple simple block children (paragraph + diagramEmbed). Fixes fixture 07 without regressing 08."
    parallel: true
    depends-on: []

  - id: strong-mark-joining
    files: [ui/src/components/editors/milkdown/serializerConfig.ts]
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Either: (a) $markSchema('strong') override so parseMarkdown uses state.openMark/closeMark spanning whole mdast subtree including inline code; OR (b) add '05-emphasis.md' to acceptableDrift allowlist with comment and move on. Prefer (a); fall back to (b) if too invasive."
    parallel: true
    depends-on: []

  - id: wire-raw-positions
    files: [ui/src/components/editors/milkdown/MilkdownEditor.tsx]
    tests: []
    description: "Register remarkCaptureRawPositions plugin FIRST in the plugin list, before diagramEmbedRemarkPlugin, so raw data is attached before any transformer runs."
    parallel: false
    depends-on: [raw-positions-plugin]

  - id: final-gate
    files: []
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Run roundTrip suite. Gate: ≥ 8/10 of ORIGINAL 10 fixtures pass byte-exact (for embeds) or normalized-exact (for others); embed fixtures 06 and 07 both byte-exact; no regressions in fixtures 11-14; acceptableDrift allowlist has ≤ 2 entries, each documented."
    parallel: false
    depends-on: [hardbreak-schema, trailing-whitespace-join, listitem-spread-fix, strong-mark-joining, wire-raw-positions]
```

### Execution Waves

**Wave 1 (parallel):** raw-positions-plugin, listitem-spread-fix, strong-mark-joining

**Wave 2 (parallel, depend on Wave 1):** hardbreak-schema, trailing-whitespace-join, wire-raw-positions

**Wave 3 (final gate):** final-gate

### Summary
- Total tasks: 7
- Total waves: 3
- Max parallelism: 3

---

## Phase 0+ Gate (final)

Pass criteria:
1. ≥ 8 of the original 10 fixtures round-trip clean (up from 6)
2. `06-embed-isolated.md` AND `07-embed-in-list.md` byte-exact
3. No regressions on fixtures 11–14 (currently passing)
4. `acceptableDrift` allowlist has ≤ 2 entries, each with a `// TODO Phase 2: ...` comment pointing at the known structural issue

**If gate passes:** mark this blueprint done, flip `wysiwygDocumentEditor` flag default-on in dev; begin Phase 2 (annotations sidecar for full-fidelity round-trip on all content; UI polish).

**If gate fails:** stop. Do not flip the flag. Document which category still drifts; the shortfall is likely at the Milkdown schema level and needs a vendored preset-commonmark fork or upstream PR.
