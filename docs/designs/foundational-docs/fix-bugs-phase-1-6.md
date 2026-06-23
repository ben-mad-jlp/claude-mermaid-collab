# Bug Fixes — Phase 1.6

## Fixed

- **C1 (Critical)** — `plugins/rawPositions.ts:38` — Wrapped negative-index slice with `Math.max(0, startOffset - 10)` so documents where a `break` falls in the first 10 chars no longer pull a bogus tail-slice of the source.
- **I1 (Important)** — `plugins/rawPositions.ts:23` — Replaced `!node.position?.end?.offset` with `node.position?.end?.offset == null`, consistent with Pass 3's explicit-undefined guard.
- **I2 (Important)** — `plugins/rawPositions.ts:33` — Same falsy-zero fix for the break-node Pass-2 guard.
- **I3 (Important)** — `serializerConfig.ts` listItem parseMarkdown runner — mdast `listItem` has no `label`/`ordered` field; ordered-ness lives on the parent `list`. Now detect ordered via `(state as any).parent?.type?.name === 'ordered_list'` and synthesize a numeric `label` from the open parent's child index. `listType` now correctly resolves to `'ordered'` for ordered list items.
- **I4 (Important)** — `MilkdownEditor.tsx` plugins useMemo — Added `autosaveDelay` and `onFlushRef` to the dep array so changing the delay on the owning component actually rebuilds the plugin list.
- **M1 (Minor)** — `plugins/rawPositions.ts` — Pass 1 now filters to block-level parents (`root`, `listItem`, `blockquote`, `list`) instead of visiting every node, so inline nodes (text/emphasis/strong) no longer get a no-op `rawTrailing` stamped on them.
- **M3 (Minor)** — `serializerConfig.ts` join function — Added a comment documenting the `newlines − 1 = blank lines between adjacent blocks` invariant and why `Math.max(0, …)` clamps the trailing-block case.
- **M5 (Minor)** — `MilkdownEditor.tsx` — Added an explicit comment above `rawPositionsPlugin` in the plugin list documenting that it MUST run before `commonmark`/`gfm`/`fidelityPlugins`, since the schema `parseMarkdown` runners read `data.style`/`data.rawTrailing`/`data.marker` stamped by rawPositions.

## Deferred / Intentional

- **M2** — Break-style `raw` slice fallback. Current logic already has the `src[startOffset - 1] === '\\'` fallback which covers the parser-dependent case; swapping to a fixed symmetric window would risk breaking currently-passing fixtures (09-hardbreaks) without a reproducible failure. Deferred.
- **M4** — `bulletMarkerRemark` no-op plugin left in the fidelity list. Not touched because removing the registration could change plugin order semantics in other suites; flagged for follow-up.
- **M6** — Ordered-list marker attrs (`1.` vs `1)`) — still no `orderedListMarker` schema override paralleling `bulletListMarker`. Out of scope for this fix pass; I3 covers the `listType` correctness on the listItem side. Flagged for follow-up.

## Test Results

```
 ✓ src/components/editors/milkdown/__tests__/roundTrip.test.ts  (16 tests) 102ms
[roundtrip] N=14 M=14 K=0

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

All 14 round-trip fixtures plus 2 harness tests pass. No regressions; adjusted the block-parent filter in M1 to include `list` so listItem spacing (fixture 07-embed-in-list.md) continues to round-trip exactly.
