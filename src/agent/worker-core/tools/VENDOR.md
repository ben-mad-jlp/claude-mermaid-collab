# Vendored third-party code — worker-core/tools

Code lifted (copied + adapted) from external MIT-licensed projects. We OWN these
snapshots; they do NOT track upstream (re-sync is a deliberate, manual decision).

| File | Upstream | Path @ ref | License | Notes |
|------|----------|-----------|---------|-------|
| `apply-edit.ts` | github.com/sst/opencode | `packages/opencode/src/tool/edit.ts` @ tag `v0.3.0` | MIT, © 2025 opencode | Lifted the 5-replacer cascade + `replace()` as a standalone pure `applyEdit()`; stripped LSP/permission/tool coupling; restyled to repo lint. v0.3.0's uniqueness guard is already uniform across replacers — the later "corruption on ambiguous edit" regression (#1261/#2433) was NOT inherited. |

## Re-sync / audit
- Pin upstream by TAG (not `dev`/latest — latest opencode is mid-Effect-migration and a poor source).
- On re-sync: diff upstream at the new tag against our snapshot, re-apply our adaptations, re-run tests.
- MIT requires preserving the copyright notice — each vendored file carries an attribution header.
