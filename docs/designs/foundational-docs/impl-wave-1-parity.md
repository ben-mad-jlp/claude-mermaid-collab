# Wave 1 Implementation — Milkdown Parity

## Tasks

### g0-router-flag
- `ui/src/components/editors/DocumentEditor.tsx` — replaced 10-line passthrough stub with `useFeatureFlags().wysiwygDocumentEditor` router; try/catch falls back to legacy; one-time `console.info` telemetry dedupe via `useRef`.
- `ui/src/components/editors/__tests__/DocumentEditor.router.test.tsx` — 5 tests: flag off → legacy, flag on → wysiwyg, prop forwarding, useFeatureFlags throw → legacy fallback, one-time telemetry via rerender.

### g11-telemetry
- `ui/src/components/editors/milkdown/plugins/telemetry.ts` (new) — `emitTelemetry()`, `nowMs()`, `EditorVariant`, `TelemetryEvent`, `TelemetrySink`; SSR no-op; `window.__telemetrySink` pluggable override defaulting to `console.debug`; try/catch swallows sink errors.
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` — added `useEffect` import, telemetry import, mount effect emitting `editor_variant='wysiwyg'`, wrapped `onPersistRef.current` to time each call and emit `autosave_latency_ms`.
- `ui/src/components/editors/milkdown/__tests__/telemetry.test.ts` (new) — 4 tests: console.debug fallback, sink routing, drift bytes passthrough, sink-error swallow.

## Verification

- `tsc --noEmit`: clean for wave files (pre-existing unrelated errors in `src/pages/onboarding/*.tsx` are out of scope).
- Tests: **9/9 pass** (5 router + 4 telemetry).
- Grep sanity: router uses `useFeatureFlags().wysiwygDocumentEditor`; MilkdownEditor emits `editor_variant: 'wysiwyg'` at both mount + persist.

Both tasks marked completed.
