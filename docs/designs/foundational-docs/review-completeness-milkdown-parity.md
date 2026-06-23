# Completeness Review — Milkdown Parity

## Summary
**Result: 2 gaps (both expected/documented), plus minor signature drift.**

## 1. Blueprint files — existence & non-stub status

### CREATED files present with real implementation
- `ui/src/components/editors/milkdown/milkdown-prose.css` — present
- `ui/src/components/editors/milkdown/plugins/codeBlockPrism.ts` — present
- `ui/src/components/editors/milkdown/plugins/imageResolver.tsx` — present, exports `imageResolverView`
- `ui/src/components/editors/milkdown/plugins/headingCollapse.ts` — present, exports `headingCollapsePlugin`, `headingCollapsePluginKey`, `createHeadingCollapsePlugin`, `getHeadingSectionId`, `headingCollapseNodeView`, `useHeadingCollapseBridge`
- `ui/src/components/editors/milkdown/plugins/rawDetails.ts` — present; exports `remarkRawDetails`, `rawDetailsRemarkPlugin`, `detailsNode`, `DetailsView`
- `ui/src/components/editors/milkdown/plugins/telemetry.ts` — present, exports `emitTelemetry`, `nowMs`, `TelemetryEvent`
- `ui/src/components/editors/milkdown/plugins/annotations/{schema,anchor,decoration,toolbar,migrator}` — all 5 files present (toolbar is `.tsx`, rest `.ts`)
- `ui/src/components/editors/__tests__/DocumentEditor.router.test.tsx` — present

### GAP 1 — strongJoin plugin absent (expected, documented deferral)
- `ui/src/components/editors/milkdown/plugins/strongJoin.ts` — **missing**
- `ui/src/components/editors/milkdown/__tests__/strongJoin.test.ts` — **missing**
- Matches known deferred status (G9 failed, 05-emphasis.md in acceptableDrift). No grep hits for `strongJoin` or `strongToMarkdown` anywhere under `ui/src/components/editors`. Confirmed deferred.

### GAP 2 — taskList roundtrip test filename drift
- Blueprint lists `__tests__/taskList.roundtrip.test.ts` — **missing by that name**
- Task-list roundtrip coverage is handled by the generic fixture-driven `__tests__/roundTrip.test.ts` which globs `__fixtures__/roundtrip/*.md` (including `15-tasklist.md`). Functional coverage exists; only the dedicated filename is absent.

## 2. Function-signature presence

| Blueprint signature | Status |
|---|---|
| `pairDetails` | **Not found by that name**. Equivalent logic lives in `plugins/rawDetails.ts` (`remarkRawDetails` + `SUMMARY_PAIR_RE` walker). Functional equivalent present; name drift. |
| `migrateInlineAnnotations` | Present — `plugins/annotations/migrator.ts:38` |
| `emitTelemetry` | Present — `plugins/telemetry.ts:22` |
| `useHeadingSectionId` | **Not found**. Closest is `getHeadingSectionId(pos)` (`headingCollapse.ts:40`) plus `useHeadingCollapseBridge()` (`:238`). Likely the same contract under renamed helpers. |
| `headingCollapsePlugin` | Present — `headingCollapse.ts:158` |
| `imageResolverView` | Present — `plugins/imageResolver.tsx:37` |
| `strongToMarkdown` | **Not found** — tied to deferred G9. Expected. |

## 3. Stub / TODO / placeholder scan
Grepped for `TODO`, `Not implemented`, `@ts-expect-error`, `FIXME`, `XXX` across all milkdown files.

Only hit:
- `plugins/__tests__/diagramEmbed.test.ts:55` — `it.skip('round-trips through Milkdown PM schema — TODO Phase 1 integration', () => {});` — pre-existing skipped test, not part of parity blueprint scope.

No stub returns, no `throw new Error('Not implemented')`, no `@ts-expect-error` in blueprint code. Implementations are real.

## 4. Tests per blueprint
Present under `__tests__/`:
- `codeBlockPrism.test.ts`
- `headingCollapse.test.tsx`
- `imageResolver.test.tsx`
- `rawDetails.test.ts`
- `roundTrip.test.ts` (covers `15-tasklist.md`, `16-raw-details.md` fixtures)
- `telemetry.test.ts`

Annotations tests at `plugins/annotations/__tests__/`:
- `migrator.test.ts` — **only 1 file present**
- Blueprint `annotations/*.test.ts` plural implies coverage for schema/anchor/decoration/toolbar is missing as dedicated test files. Potential gap (minor) — depends on whether blueprint required per-module tests or just the migrator.

Missing test files:
- `__tests__/taskList.roundtrip.test.ts` (covered indirectly, see Gap 2)
- `__tests__/strongJoin.test.ts` (deferred)

## 5. Fixtures
- `__fixtures__/roundtrip/15-tasklist.md` — present
- `__fixtures__/roundtrip/16-raw-details.md` — present
- Full fixture set 01–16 intact.

## 6. Annotations directory
All 5 blueprint files present in `plugins/annotations/`:
- `schema.ts`, `anchor.ts`, `decoration.ts`, `toolbar.tsx`, `migrator.ts` ✓

## Findings summary
1. **G9 strongJoin deferral confirmed** — no `strongJoin.ts`, no `strongToMarkdown` — matches documented failed/deferred state.
2. **taskList.roundtrip.test.ts filename missing** — roundtrip coverage present via generic `roundTrip.test.ts` + `15-tasklist.md` fixture. Acceptable substitute.
3. **Signature drift (non-blocking)**: `pairDetails` → logic in `remarkRawDetails`; `useHeadingSectionId` → `getHeadingSectionId` + `useHeadingCollapseBridge`; `strongToMarkdown` → deferred with G9.
4. **Possible minor test gap**: annotations sub-modules (schema/anchor/decoration/toolbar) have only the migrator unit-tested under `plugins/annotations/__tests__/`. Verify if blueprint required individual test files.
5. All other blueprint files, exports, fixtures, and router test are present with real (non-stub) implementations.
