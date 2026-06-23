# Bug Review — Phase 1.6 Annotations

Scope: `ui/src/components/editors/milkdown/` (serializerConfig.ts, plugins/rawPositions.ts, MilkdownEditor.tsx, __tests__/roundTrip.test.ts).

## Critical

### C1. Negative-index slice in break-style detection
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:38`

```ts
if (/<br\s*\/?>/i.test(src.slice(startOffset - 10, endOffset + 1))) {
```

`String.prototype.slice` treats a negative first argument as *offset-from-end-of-string*. When a `break` node appears within the first 10 characters of the file (e.g. a short doc starting with a line ending in `  \n` or `<br>`), `startOffset - 10` is negative and `src.slice(-N, …)` silently pulls a slice from the tail of the source, producing a completely wrong haystack for the `<br>` test.

**Fix:** `src.slice(Math.max(0, startOffset - 10), endOffset + 1)` — matching the `Math.max(0, …)` guard already used on line 36.

## Important

### I1. Zero-offset falsy trap in Pass 1
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:23`

```ts
if (!node.position?.end?.offset) return;
```

Uses truthiness instead of an explicit null-check. Any node whose `end.offset` is `0` is skipped. Realistically end.offset is only 0 for a zero-length empty root before children exist, so practical impact is low, but the idiom is fragile and inconsistent with Pass 3 (line 52) which correctly uses `=== undefined`. Combined with I2, the pattern is unsafe.

**Fix:** `if (node.position?.end?.offset == null) return;`

### I2. Zero-offset falsy trap in Pass 2 (break nodes)
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:34`

```ts
if (!node.position?.start?.offset) return;
```

Same falsy-zero trap. A `break` cannot be at offset 0, so the practical risk is nil, but this guard would also early-return for a `break` whose `start.offset === 0` without capturing `style`.

**Fix:** `if (node.position?.start?.offset == null) return;`

### I3. Ordered-list items always become `listType: 'bullet'`
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:212-213`

```ts
const label = (node as any).label != null ? `${(node as any).label}.` : '•';
const listType = (node as any).label != null ? 'ordered' : 'bullet';
```

mdast `listItem` nodes do not carry a `label` property — ordered numbering lives on the parent `list` node (`ordered`, `start`) and each `listItem` has a `checked` field but no `label`. So `(node as any).label` is always `undefined`, and `listType` is *always* `'bullet'` even inside ordered lists. Ordered-list items will round-trip with the wrong `listType` attr, and any code later keying off `listType === 'ordered'` (e.g. the tight-list bullet vs. ordered rendering) will behave incorrectly.

**Fix:** Detect ordered via the parent in the runner (`state` exposes the current parent/ancestor) or pass the parent list's `ordered` flag via a surrounding node attr; e.g., have `bulletListMarker` / a sibling `ordered_list` schema set an attr, or check `(state as any).parent?.type?.name === 'ordered_list'`, or read the grandparent mdast node's `ordered` flag before opening.

### I4. `autosaveDelay` prop becomes stale after first render
**File:** `ui/src/components/editors/milkdown/MilkdownEditor.tsx:95-117`

```ts
const plugins = useMemo(() => [
  …
  ...autosavePlugin({ docId, onChangeRef, onPersistRef, onFlushRef, delay: autosaveDelay }),
  …
], [docId, diagramEmbedView]);
```

`autosaveDelay` (and `onFlushRef`, if the caller passes a fresh one) are captured at memo time but the dep array omits them, so changing `autosaveDelay` on the owning component does not propagate to the plugin. If the autosave plugin reads `delay` once at construction, the new value never takes effect; if it reads through a ref you'd need to pass a ref instead.

**Fix:** Either pass `autosaveDelay` through a ref (pattern already used for `onChange`/`onPersist`) or include it in the dep array. Likewise for `onFlushRef` if it's treated as stable.

## Minor

### M1. Pass 1 pollutes inline nodes with `rawTrailing`
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:21-29`

`visit(tree, …)` with no node-type filter walks inline children (text, emphasis, strong, etc.) and stamps `rawTrailing` on them. Nothing consumes inline `rawTrailing`, but it inflates the mdast, can show up in serialized `data`, and mixes semantic block-spacing with inline content. Limit Pass 1 to block-level nodes (e.g. filter by `parent.type === 'root'` or a known block set, or use `visit(tree, [...blockTypes], …)`).

### M2. Break-style `raw` slice can miss the backslash it's looking for
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:36-43`

`raw = src.slice(Math.max(0, startOffset - 3), endOffset)`. For a backslash break, the `\` is at `startOffset - 1` and the break's `endOffset` is usually the `\n` itself. The fallback `src[startOffset - 1] === '\\'` compensates, but `raw.includes('\\\n')` depends on whether `endOffset` includes the newline — mdast break positions are not strictly standardized across parsers. Consider basing the detection purely on a small fixed window around `startOffset` (e.g. `src.slice(Math.max(0, startOffset - 2), Math.min(src.length, startOffset + 2))`) for determinism.

### M3. `blankLines` can be negative for the final block
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:52-54`

```ts
const blankLines = (raw.match(/\n/g) ?? []).length - 1;
return Math.max(0, blankLines);
```

If `rawTrailing` is the empty string (last block with no trailing newline — end of file), `blankLines === -1` and `Math.max` clamps to 0, which is fine. Call out only because the `- 1` convention is unusual: 1 newline = blocks adjacent (0 blank lines), 2 newlines = 1 blank line. The logic is correct but should have a comment explaining the "newlines − 1 = blank lines between adjacent blocks" invariant.

### M4. `bulletMarkerRemark` is a registered no-op
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:349-351`

`bulletMarkerRemark` is a no-op plugin but is still included in `fidelityPlugins`. It runs on every parse for no effect. Either remove it until implemented, or gate it behind a feature flag.

### M5. `hardBreakStyle.parseMarkdown` relies on Pass 2 running first
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:319-327` + `MilkdownEditor.tsx:97-105`

The schema's `parseMarkdown` runner reads `(node as any).data?.style`, populated by `rawPositionsPlugin`. `MilkdownEditor.tsx` registers `rawPositionsPlugin` first (good), and the test harness does the same (good). But there is no defensive fallback comment explaining the ordering requirement — a future reorder would silently lose break-style fidelity without any test catching it unless the fixtures exercise every break style.

### M6. Ordered-list marker attrs never captured
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:126-172`

Only `bullet_list` has a marker-preserving schema override. Ordered lists (`1.` vs `1)`) will drop marker fidelity, and the rawPositions Pass 3 marker capture (which handles `\d+[.)]`) has no downstream consumer. Either add an `orderedListMarker` schema paralleling `bulletListMarker`, or document the gap.

## Summary

Bug review complete. 1 critical, 4 important, 6 minor. Saved to review-bugs-phase-1-6.
