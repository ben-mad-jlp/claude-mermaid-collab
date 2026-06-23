# Completeness Review — Phase 1.6 Annotations

## Verdict
Everything complete. 0 gaps.

## Task checklist (7/7)
- raw-positions-plugin: `ui/src/components/editors/milkdown/plugins/rawPositions.ts` — real implementation, 3 passes (rawTrailing, break style, list marker). Offset-0 guard fix landed in Wave 1.
- listitem-spread-fix: `serializerConfig.ts` — bullet_list toMarkdown sets spread:false; list_item carries rawTrailing attr for per-item spread.
- strong-mark-joining: Allowlisted `05-emphasis.md` per blueprint fallback (b). 1 entry, with clear comment at lines 57–61 of `roundTrip.test.ts`.
- hardbreak-schema: `hardBreakStyle` $nodeSchema('hardbreak', …) in `serializerConfig.ts` (lines 289+). Attrs `style: 'spaces'|'backslash'|'html'`. Emits an mdast break with data.style so the default break handler renders the exact literal. Registered in fidelityPlugins (line 360).
- trailing-whitespace-join: `join` array in remarkStringifyOptionsCtx (lines 48–50) reads `left?.data?.rawTrailing`. Supported by `headingRawTrailing` and `list_item` rawTrailing attrs that carry data round-trip.
- wire-raw-positions: `MilkdownEditor.tsx` line 98 — `rawPositionsPlugin` registered FIRST in the plugin array (before commonmark, gfm, diagramEmbedRemarkPlugin).
- final-gate: 14/14 fixtures pass.

## Test results (live run)
`npx vitest --run roundTrip rawPositions`:
- rawPositions: 7/7
- roundTrip: 16/16
- Total: 23/23

`[roundtrip] N=14 M=14 K=0` — all 14 fixtures attempted, all passed, 0 deferred. 05-emphasis short-circuits via allowlist (counted in M). Original 10 pass criterion: met (≥8). 06 + 07 byte-exact: met. 11–14 unregressed: met.

## Stub check
No TODO / `Not implemented` / `NotImplementedError` / `todo!()` markers in any modified milkdown file. The one TODO in `diagramEmbed.test.ts` is a pre-existing skipped Phase 1 integration test, unrelated to Phase 1.6.

## acceptableDrift allowlist
1 entry (`05-emphasis.md`), ≤ 2 limit satisfied. Comment explains rationale (parse-side already spans subtree; fix requires custom mdast-util-to-markdown strong join handler, deferred as pragmatic).

## Phase 0+ Gate
- ≥ 8/10 original fixtures pass: met (effectively 10/10 minus 1 allowlisted = 9 clean passes)
- 06 + 07 byte-exact: met
- 11–14 unregressed: met
- Allowlist ≤ 2 with comments: met

Gate fully satisfied. `wysiwygDocumentEditor` is eligible to flip default-on in dev per the blueprint's "If gate passes" branch.
