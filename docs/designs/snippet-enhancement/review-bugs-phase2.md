# Bug Review — Phase 2

Scope: `propose_code_edit` MCP tool + accept/reject endpoints + `ProposedEditReview` UI banner.

## Summary

**No correctness bugs found.** All route handlers, path parsing, async flows, effect cleanup, and test expectations check out.

## Files Reviewed

- `src/routes/code-api.ts` — new handlers and route dispatch
- `src/mcp/tools/code.ts` — `proposeCodeEditSchema` + `handleProposeCodeEdit`
- `src/mcp/setup.ts` — tool registration and dispatch case
- `ui/src/lib/api.ts` — `acceptProposedEdit` / `rejectProposedEdit`
- `ui/src/components/editors/CodeEditor.tsx` — envelope parsing and banner render
- `ui/src/components/editors/ProposedEditReview.tsx` (new)
- `src/routes/__tests__/code-api.test.ts` (new)

## Verification of specific concerns

### 1. Route matching order (code-api.ts lines 63–89)
`/accept` and `/reject` specific matchers are declared BEFORE the base `/proposed-edit/:id` matcher. Since the regexes also anchor with `$`, they would not incorrectly match each other even if reordered, but the explicit ordering is defensive and correct.

### 2. Path parsing `path.split('/')[2]` (lines 68, 77)
For `path = /proposed-edit/abc/accept`:
`split('/')` → `['', 'proposed-edit', 'abc', 'accept']`. Index `[2]` = `'abc'`. Correct.
Base-path handler uses `path.split('/').pop()!` which also correctly yields `'abc'` for `/proposed-edit/abc`. Both styles work.

### 3. Broadcast correctness
- `handleCreateProposedEdit` noop short-circuit returns BEFORE any save/broadcast. Correct.
- `handleRejectProposedEdit` idempotent path returns BEFORE any save/broadcast. Correct.
- All mutating paths re-read the snippet via `getSnippet` AFTER `saveSnippet` to obtain the fresh `lastModified`. Consistent with the existing push/sync handlers in this file.

### 4. ProposedEditReview Escape key cleanup (lines 72–79)
`useEffect` returns `() => document.removeEventListener('keydown', handleKeyDown)`. The effect also early-returns when `previewOpen` is false, so the listener is only attached when the modal is visible and torn down on close / unmount. No leak.

Minor note (not a bug): the `setPreviewOpenRef` ref indirection at lines 69–70 is unnecessary since `setPreviewOpen` is stable from `useState`. Harmless dead code; not in scope.

### 5. `parseLinkedEnvelope` return shape
When `proposedEdit` is absent, the function returns the full linked shape with `proposedEdit: null`. All existing consumers either check `envelope?.linked` / specific fields, and the new consumer uses `envelope.proposedEdit && ...`. Both linked-without-proposal and linked-with-proposal paths return a consistent object shape. Correct.

Also: `code` was added as a parsed field with `''` fallback, which is what the banner renders as `currentCode`. No null/undefined access in the diff view.

### 6. Stale closure in `handleAcceptProposal` / `handleRejectProposal`
Dependencies: `[currentSession, snippetId, refreshSnippet]`. `snippetId` is a prop (stable within a render), `currentSession` comes from the store, `refreshSnippet` is a `useCallback`. No stale envelope captured — the handlers don't read `envelope` at all, they just hit the API. Correct.

### 7. Banner stacking
Both the proposed-edit banner and the conflict banner are in normal document flow inside `<div className="flex flex-col h-full">`. They stack vertically, no `fixed` positioning. When both are present (sync conflict + new proposal), they render one above the other without overlap.

### 8. Test correctness (code-api.test.ts)
- All expectations (`body.success`, `body.hasProposedEdit`, `body.dirty`, `body.noop`, status codes, error message regex) match the actual handler responses.
- `beforeEach` deletes prior snippets so each test starts clean.
- `getWebSocketHandler()` returns `null` in tests (no WS init), so the broadcast branches are safely skipped.
- The "accept: sets dirty" test is consistent with `envelope.originalCode` being the pre-proposal baseline (`'const x = 1;\n'`), which differs from the accepted `'const x = 42;\n'` → `dirty = true`. Correct.
- The "reject: doesn't touch other fields" test verifies `code` stays `'const x = 1;\n'` and `dirty` stays `false`, which matches the handler behavior (only `delete envelope.proposedEdit`).
- The "returns 400 when newCode is missing" test matches the `typeof body?.newCode !== 'string'` guard.
- The 404 path test (nonexistent id) correctly hits `getSnippet` → null → 404.

### 9. noop behavior when envelope has existing proposedEdit
Edge case: if a proposedEdit already exists AND the incoming `newCode` matches `envelope.code` (not the proposed code), the handler short-circuits and does NOT clear the stale proposedEdit. This is by design per the noop contract ("no state change"), and the response honestly reports `hasProposedEdit: !!envelope.proposedEdit`. Not a bug, but worth noting for future callers — the noop short-circuit preserves any pre-existing proposal.

### 10. Error handling
- `acceptProposedEdit` / `rejectProposedEdit` in `api.ts` use `.catch(() => ({}))` on the error-body parse, then throw with a sensible fallback. Correct.
- `handleProposeCodeEdit` in MCP tool casts response as `any` but reads `.error` safely. Correct.
- CodeEditor handlers wrap calls in try/catch, log on error, and set a flash message. No swallowed async errors.

## Minor observations (NOT bugs — informational)

- `src/mcp/tools/code.ts` `handleProposeCodeEdit`: `await response.json() as any` returns `any`; caller stringifies it. Fine.
- `ProposedEditReview.tsx` `setPreviewOpenRef` indirection is dead code (see 4). Safe.
- `handleCreateProposedEdit` noop uses `envelope.code ?? ''` — defensive default, fine.
- No file-level locking: a concurrent `propose_code_edit` racing with `/accept` could clobber the accepted content with a new proposal. This is a pre-existing concurrency pattern in this file (push/sync have the same property); not introduced by this change.

## Verdict

No Critical, Important, or Minor correctness bugs introduced by Phase 2. The implementation is internally consistent, route dispatch is correctly ordered, path parsing is correct, broadcasts re-read after save, effect cleanup is present, and test expectations align with handler behavior.
