# Wave 1 — Phase 1.6 Annotations

## Tasks
- **raw-positions-plugin**: Plugin + tests already present from prior work. Fixed falsy-offset bug in per-list marker loop (treated `offset === 0` as missing, dropping the first item's marker).
- **listitem-spread-fix**: `bullet_list` toMarkdown runner in `serializerConfig.ts` now opens 'list' with `spread: false` unconditionally. Per-item spread (`spread: hasEmbed` in `listItemTight`) remains; it handles embed-in-list internal blank lines.
- **strong-mark-joining**: Accepted-drift allowlist entry for `05-emphasis.md` retained. Comment rewritten to clarify rationale (parse-side already spans subtree; fix is serialize-side and out of scope).

## Files changed
- `ui/src/components/editors/milkdown/plugins/rawPositions.ts` — offset-0 guard fix
- `ui/src/components/editors/milkdown/serializerConfig.ts` — tight bullet list
- `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts` — allowlist comment

## Verification
- 7/7 rawPositions tests pass
- tsc errors unrelated to changed files
