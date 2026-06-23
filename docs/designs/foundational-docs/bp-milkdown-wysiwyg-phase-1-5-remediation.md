# Blueprint: Milkdown WYSIWYG — Phase 1.5 Remediation

Scope: close the gaps and critical bugs surfaced by `/vibe-review` on the Phase 0+1 implementation. Phase 0 go/no-go gate currently **fails** (4/10 fixtures round-trip vs ≥8/10 required). Flag `wysiwygDocumentEditor` stays default-off until this blueprint completes and the gate turns green.

## Source Artifacts
- `review-bugs` — 9 bugs (2 Critical, 5 Important, 2 Minor)
- `review-completeness` — 14 gaps (4 structural/critical, 10 spec drifts)
- `bp-milkdown-wysiwyg-phase-0-1` — the original blueprint being remediated
- `design-milkdown-migration`

---

## 1. Structural Diagnosis

Three converged issues make the embed pipeline non-functional:

1. **Parse side dead:** no remark transformer converts `{{kind:refId}}` text into `diagramEmbed` MDAST nodes, so `parseMarkdown.runner` in `diagramEmbed.ts` is never reached (Bug I5 ≡ Gap G4).
2. **View side dead:** `DiagramEmbedView` component exists but is never registered as a PM node view; `MilkdownEditor.tsx` doesn't import it (Gap G5).
3. **Serialize side broken:** `toMarkdown` emits a bare inline text node at block position with no `closeBlock` (Bug C2 ≡ Gap G3).

Separately, `serializerConfig.ts` is an empty `fidelityPlugins = []` stub (Gap G2), which is the direct cause of 6/10 fixtures failing the round-trip gate (list markers, emphasis markers, hard breaks, escapes).

Test harness is also inverted: `roundTrip.test.ts` uses `it.fails(...)` so tests currently pass *on drift* and fail *on identity* (Gap G11).

---

## 2. Function Blueprints

### `remarkDiagramEmbed` (new, in `plugins/diagramEmbed.ts` or sibling file)

**Pseudocode:**
1. Export a `unified`/remark plugin `remarkDiagramEmbed()` returning a transformer
2. Transformer walks the MDAST tree with `unist-util-visit`, visiting every `text` node whose parent is a `paragraph`
3. For each text node: run `EMBED_RE` (global). If no match, return. Otherwise:
   - Split the text by matches into alternating text + `diagramEmbed` nodes
   - If the original paragraph contained ONLY the embed (and whitespace), replace the paragraph with the `diagramEmbed` block node
   - Otherwise split the paragraph at each embed into (paragraph, diagramEmbed, paragraph, …)
4. Register the plugin in Milkdown via `remarkPlugin` context (Milkdown exposes remark plugin list on config ctx)

**Tests:** unit — feed MDAST with `{{diagram:foo}}` inside paragraph vs isolated; assert correct block-node split.

### `diagramEmbed.toMarkdown.runner` (fix)

**Pseudocode:**
1. Emit a paragraph-level node via `state.addNode('paragraph', undefined, undefined, () => state.addNode('text', undefined, `{{${kind}:${refId}}}`))` OR use `state.addNode('html', undefined, `{{${kind}:${refId}}}\n`)` depending on mdast runner shape actually provided by Milkdown
2. Call `state.closeBlock(node)` after emission so subsequent blocks don't merge

**Tests:** round-trip `{{diagram:foo}}` byte-exact; embed inside list and mid-paragraph covered by fixtures 06/07.

### Register `DiagramEmbedView` as node view

**Pseudocode:**
1. In `MilkdownEditor.tsx`, inside `useEditor` config callback, after plugin registration:
   - Get `prosePluginsCtx` or use `$view` helper from Milkdown
   - Register view: `diagramEmbedSchema.key` → React component `DiagramEmbedView`
2. Pass project/session via context provider wrapping `<Milkdown/>`

**Tests:** mount editor with markdown containing an embed; query for iframe; assert src = `resolveEmbedSrc(...)`.

### `fidelityPlugins` (fill in empty stub)

**Pseudocode — one Milkdown `$markSchema` / `$nodeSchema` override per concern:**
1. `emphasisMarker` — parse: on emphasis node, capture original marker (`*` vs `_`) from raw source via `mark.attrs.marker`. Serialize: emit captured marker; fall back to `*`.
2. `strongMarker` — same, for `**` vs `__`.
3. `bulletMarker` — parse: on `listItem`, walk up to `list`, read `marker` field from MDAST (remark preserves `-/*/+`). Serialize: emit captured marker.
4. `hardBreakStyle` — parse: detect `\n` preceded by two spaces vs `<br>`; store as attr. Serialize: honor attr.
5. `escapeNormalization` — prevent double-escaping of `\_`, `\*`, `\[` during serialize (Milkdown default over-escapes).

Export as array `fidelityPlugins: MilkdownPlugin[]` consumed by `MilkdownEditor`.

**Tests:** each override covered by a dedicated fixture round-trip (fixtures 02, 05, 09 + two new ones).

### `roundTrip.test.ts` (fix inverted semantics)

**Pseudocode:**
1. Replace `it.fails(name, ...)` with `it(name, ...)` everywhere
2. Add an `acceptableDrift` allowlist map `{ fixtureName: reason }` — empty by default; any fixture listed there is marked `it.skip` with a TODO reference to this blueprint
3. Log a summary at suite end: `N/10 passing, M acceptable drift, K failures` — suite fails if K > 0
4. Add test for embed fixtures specifically: assert exact byte equality (no drift allowed for embeds)

### `DocumentEditor.wysiwyg.tsx` — save/cancel fixes

**Pseudocode:**
1. `flushRef` now returns `string | undefined` (the latest markdown flushed), not `void`
2. `handleSave`: `const latest = flushRef.current?.() ?? content; await updateDocument(id, { content: latest, ... })`; then `setContent(latest)` to re-sync React state
3. `handleCancel`: call `milkdownRef.current?.setMarkdown(document.content)` to reset the PM doc, not just React state
4. The `useEffect` watching `document` should key on `document.id` only, not `document.content`, to avoid clobbering in-flight edits when server echoes back the save

### `autosave.ts` — docId switch race fix

**Pseudocode:**
1. Capture `pluginInstanceId = Symbol()` in factory closure
2. On cleanup, only null `onFlushRef.current` if its identity still matches this instance
3. On docId change: cancel pending debounce via `debounced.cancel()` before binding new listener
4. Use latest-ref pattern for `onChange` and `onPersist` so memoization on `[docId]` doesn't freeze stale closures (resolves Bug I2)

### `MilkdownEditor.tsx` — closure/memoization fix

**Pseudocode:**
1. `const onChangeRef = useRef(onChange); useLayoutEffect(() => { onChangeRef.current = onChange; });` — same for `onPersist`, `onFlushRef`
2. Plugin list builder reads from refs, so `useMemo([docId])` is safe
3. Expose `setMarkdown(md)` imperative method via forwarded ref for cancel-reset

### `milkdownEmbedBridge.ts` — encode URI components

**Pseudocode:** `encodeURIComponent(refId)`, `encodeURIComponent(theme ?? 'dark')`, `encodeURIComponent(project)`, `encodeURIComponent(session)`. Keep single `kind` param; do not branch URL by kind (align with G1 resolution: single `kind` query param is correct).

### Fixtures — add 4 missing real-doc fixtures

Blueprint called for 5 real + 5 synthetic. Only 1 real-doc fixture exists. Add 4 more copied from session documents (`design-milkdown-migration`, `research-wysiwyg-markdown`, `impl-wave-1-milkdown`, `impl-waves-3-6-milkdown`).

### Legacy test gating — verify and finish

Confirm the 2 obsolete test blocks (click-to-source, sync-scroll toggle) are removed and remaining tests import `DocumentEditorLegacy` directly. Currently only 1 test line was modified — likely incomplete.

---

## 3. Task Dependency Graph

```yaml
tasks:
  - id: fix-embed-remark
    files:
      - ui/src/components/editors/milkdown/plugins/diagramEmbed.ts
    tests:
      - ui/src/components/editors/milkdown/plugins/__tests__/diagramEmbed.test.ts
    description: "Add remarkDiagramEmbed transformer that walks paragraph text nodes and splits on EMBED_RE into block diagramEmbed nodes. Export alongside the $nodeSchema. Test parse path end-to-end."
    parallel: true
    depends-on: []

  - id: fix-embed-tomarkdown
    files:
      - ui/src/components/editors/milkdown/plugins/diagramEmbed.ts
    tests:
      - ui/src/components/editors/milkdown/plugins/__tests__/diagramEmbed.test.ts
    description: "Fix toMarkdown.runner to emit embed as a block-level text/html node followed by state.closeBlock(node). Byte-exact round-trip for {{diagram:foo}}."
    parallel: false
    depends-on: [fix-embed-remark]

  - id: register-embed-view
    files:
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests: []
    description: "Import DiagramEmbedView; register it as PM node view against diagramEmbed schema key inside useEditor config. Wrap <Milkdown/> with project/session context provider so the view can read them."
    parallel: false
    depends-on: [fix-embed-remark]

  - id: fill-fidelity-plugins
    files:
      - ui/src/components/editors/milkdown/serializerConfig.ts
    tests:
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    description: "Replace empty fidelityPlugins=[] stub with 5 Milkdown plugins: emphasisMarker, strongMarker, bulletMarker, hardBreakStyle, escapeNormalization. Each preserves original marker/style via node attrs captured at parse time."
    parallel: true
    depends-on: []

  - id: fix-roundtrip-harness
    files:
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    tests:
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    description: "Replace all it.fails(...) with it(...). Add acceptableDrift allowlist (empty). Enforce byte equality for embed fixtures. Log N/M/K summary; suite fails on K>0."
    parallel: true
    depends-on: []

  - id: add-real-doc-fixtures
    files:
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/11-real-design.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/12-real-research.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/13-real-impl-wave-1.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/14-real-impl-waves-3-6.md
    tests: []
    description: "Copy 4 additional real session documents as fixtures to reach 5-real + 5-synthetic per original blueprint."
    parallel: true
    depends-on: []

  - id: fix-bridge-encoding
    files:
      - ui/src/lib/milkdownEmbedBridge.ts
    tests: []
    description: "encodeURIComponent on refId/theme/project/session in resolveEmbedSrc. Remove EMBED_RE_G if unused after fix-embed-remark."
    parallel: true
    depends-on: []

  - id: fix-editor-closures
    files:
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests: []
    description: "Latest-ref pattern for onChange/onPersist/onFlushRef so useMemo([docId]) doesn't freeze stale closures. Forward imperative setMarkdown(md) method via ref for cancel-reset."
    parallel: false
    depends-on: [register-embed-view]

  - id: fix-autosave-race
    files:
      - ui/src/components/editors/milkdown/plugins/autosave.ts
    tests:
      - ui/src/components/editors/milkdown/plugins/__tests__/autosave.test.ts
    description: "Instance-identity guard on onFlushRef cleanup. Cancel pending debounce on docId switch. Latest-ref for onChange/onPersist. Add tests for docId switch cancels pending write to old doc."
    parallel: true
    depends-on: []

  - id: fix-wysiwyg-save-cancel
    files:
      - ui/src/components/editors/DocumentEditor.wysiwyg.tsx
    tests:
      - ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.test.tsx
    description: "flushRef returns latest markdown. handleSave uses returned value, then setContent to re-sync React state. handleCancel calls milkdownRef.setMarkdown(document.content). useEffect keys on document.id only, not .content."
    parallel: false
    depends-on: [fix-editor-closures]

  - id: finish-legacy-test-gating
    files:
      - ui/src/components/editors/__tests__/DocumentEditor.test.tsx
    tests:
      - ui/src/components/editors/__tests__/DocumentEditor.test.tsx
    description: "Audit 597-line file against original blueprint task: remove 2 obsolete blocks (click-to-source, sync-scroll toggle); ensure legacy-specific assertions import DocumentEditorLegacy directly; confirm all remaining tests pass."
    parallel: true
    depends-on: []

  - id: rerun-phase-0-gate
    files: []
    tests:
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
      - ui/src/components/editors/milkdown/plugins/__tests__/diagramEmbed.test.ts
    description: "Run roundTrip.test + diagramEmbed.test + wysiwyg.test. Gate criterion: ≥ 8/10 fixtures round-trip clean with any drift in the acceptable column; embed fixtures byte-exact; no acceptableDrift entries remaining (empty allowlist)."
    parallel: false
    depends-on: [fix-embed-tomarkdown, register-embed-view, fill-fidelity-plugins, fix-roundtrip-harness, add-real-doc-fixtures, fix-bridge-encoding, fix-wysiwyg-save-cancel, fix-autosave-race, finish-legacy-test-gating]
```

### Execution Waves

**Wave 1 (parallel, no deps):**
- fix-embed-remark, fill-fidelity-plugins, fix-roundtrip-harness, add-real-doc-fixtures, fix-bridge-encoding, fix-autosave-race, finish-legacy-test-gating

**Wave 2 (depend on Wave 1):**
- fix-embed-tomarkdown (fix-embed-remark)
- register-embed-view (fix-embed-remark)

**Wave 3 (depend on Wave 2):**
- fix-editor-closures (register-embed-view)

**Wave 4 (depend on Wave 3):**
- fix-wysiwyg-save-cancel (fix-editor-closures)

**Wave 5 (final gate):**
- rerun-phase-0-gate (all above)

### Summary
- Total tasks: 12
- Total waves: 5
- Max parallelism: 7 (Wave 1)

---

## Phase 0 Gate (Re-run)

After Wave 5, the gate is green if and only if:

1. `roundTrip.test.ts` passes ≥ 8/10 fixtures with byte equality; remaining drift only in the acceptable column of the design doc
2. `diagramEmbed.test.ts` round-trips `{{diagram:foo}}` byte-exact (both isolated and inside a list)
3. `acceptableDrift` allowlist in `roundTrip.test.ts` is empty
4. Manual smoke: open a real-doc fixture in the wysiwyg editor; edit one word; git diff shows only the one-word change
5. No Critical or Important items from `review-bugs` remain open

**If gate passes:** the `wysiwygDocumentEditor` flag can be flipped on in a dev environment; proceed to Phase 2 (annotations sidecar, polish, rollout).

**If gate fails:** stop. Capture new drift as a Phase 1.6 follow-on. Do not enable the flag.
