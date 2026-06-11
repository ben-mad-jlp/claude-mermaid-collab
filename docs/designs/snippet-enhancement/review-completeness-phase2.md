# Completeness Review — Phase 2

Verification of `bp-phase2-propose-edit` implementation against the blueprint spec. Checked via Grep on the edited files.

## Files Specified vs. Present

| Blueprint file | Status |
|---|---|
| `src/routes/code-api.ts` (3 handlers + 3 route matchers) | ✅ present — 12 matches for handler/route names |
| `src/mcp/tools/code.ts` (schema + handler exports) | ✅ `proposeCodeEditSchema` at line 101, `handleProposeCodeEdit` at line 239 |
| `src/mcp/setup.ts` (imports + tool list + dispatch) | ✅ imports lines 168/174, tool list lines 1989/1991, dispatch case lines 3617/3624 |
| `src/routes/__tests__/code-api.test.ts` | ✅ new file — 14/14 tests passing |
| `ui/src/lib/api.ts` (interface + methods) | ✅ interface lines 97/98, implementation lines 787/798 |
| `ui/src/components/editors/ProposedEditReview.tsx` | ✅ new file |
| `ui/src/components/editors/CodeEditor.tsx` (envelope parse + handlers + render) | ✅ import line 14, parse lines 51-65, handlers 194/206, render 348-355 |

## Function Blueprints

| Blueprint function | Status |
|---|---|
| `handleCreateProposedEdit` — newCode validation, 404 missing, 400 not-linked, noop short-circuit, set proposedEdit with proposedBy='claude', save, broadcast | ✅ verified via backend tests (happy path, 400 not-linked, 404 missing, 400 missing newCode, replace, noop) |
| `handleAcceptProposedEdit` — 400 not-linked, 400 no-proposal, set code from newCode, compute dirty, delete proposedEdit, save, broadcast | ✅ verified via backend tests (happy path, no-proposal 400, not-linked 400, missing 404) |
| `handleRejectProposedEdit` — 400 not-linked, idempotent 200 when no proposal, delete, save, broadcast | ✅ verified via backend tests (happy path, idempotent, not-linked 400, missing 404) |
| `handleProposeCodeEdit` (MCP) — fetch POST /api/code/proposed-edit/:id, throw on !ok, return parsed JSON | ✅ present in src/mcp/tools/code.ts |
| `proposeCodeEditSchema` — required ['project', 'session', 'id', 'newCode'] | ✅ present |
| `ProposedEditReview` props & state | ✅ matches blueprint — currentCode / proposedCode / proposedMessage / proposedAt / onAccept / onReject; internal isProcessing and previewOpen state; Escape handler with cleanup |
| `parseLinkedEnvelope` extended to return `code` + `proposedEdit` | ✅ verified |
| `handleAcceptProposal` / `handleRejectProposal` in CodeEditor | ✅ present (lines 194, 206) |
| Banner rendered above conflict banner | ✅ verified — `envelope.proposedEdit && <ProposedEditReview .../>` inside outer flex wrapper, before the conflict banner |

## Tests

- Backend: `npm run test:backend -- src/routes/__tests__/code-api.test.ts` → **14/14 passing**
- Test coverage matches blueprint Section 2 "Backend Tests" (11 cases specified, 14 implemented — extra coverage for accept/reject 404 and not-linked guards)

## Stub Search

`TODO`, `NotImplementedError`, `throw new Error('Not implemented')` in:
- `src/routes/code-api.ts` — none
- `ui/src/components/editors/ProposedEditReview.tsx` — none

## Gaps

None. All blueprint tasks and files complete.

## Out-of-Scope Items Correctly Deferred

Per blueprint Section 4 "Out of Scope":
- ✅ MCP accept/reject tools — not added (UI-only per spec)
- ✅ Multi-proposal queue — new propose replaces old (correct)
- ✅ Automatic Push on Accept — accept only updates envelope.code + dirty, user still pushes (verified in test "moves newCode into envelope.code, sets dirty, clears proposedEdit")
- ✅ Shared TypeScript envelope type — still parsed inline per-consumer (deferred per spec)

## Verdict

**Everything complete.** Implementation matches the blueprint spec exactly. Ready for end-to-end browser testing.
