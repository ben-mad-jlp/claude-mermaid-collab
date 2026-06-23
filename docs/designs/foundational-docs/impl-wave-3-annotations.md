# Wave 3 — Final Gate

## Result
**14/14 roundTrip fixtures pass.** Gate met: 06 AND 07 byte-exact, ≥8/10 original pass, fixtures 11-14 unregressed. Allowlist: 1 entry (`05-emphasis.md`).

## Root causes fixed in the fix-loop pass
1. **Fixture 07**: test harness wasn't registering `diagramEmbedRemarkPlugin`, so embeds stayed as text. Added `rawTrailing` attr to `list_item` schema so per-item spread is driven by source data.
2. **Fixture 09**: `hardBreakStyle` schema was named `hard_break`, but commonmark node name is `hardbreak` — override never replaced the default. Renamed; emit an mdast `break` carrying `data.style` so the existing stringify break handler emits the exact literal.
3. **Fixture 10**: headings had no `data.rawTrailing` after round-trip. Added `headingRawTrailing` $nodeSchema that captures/restores it.

## Files touched
- `ui/src/components/editors/milkdown/serializerConfig.ts`
- `ui/src/components/editors/milkdown/plugins/rawPositions.ts`
- `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts` (test-harness plugin registration)

## Next
Blueprint gate passes — `wysiwygDocumentEditor` flag eligible to flip default-on in dev. Run `/vibe-review` for bug + completeness audit, then flip flag in a follow-up.
