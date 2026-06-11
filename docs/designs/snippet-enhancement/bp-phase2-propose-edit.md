# Blueprint: Phase 2 — Claude MCP Edit Artifact Tool (`propose_code_edit`)

Phase 2 of the snippet-enhancement migration. Adds an MCP tool that lets Claude propose edits to a linked code artifact, storing the proposal on the snippet envelope and surfacing it in the UI with an Accept/Reject review flow that reuses the Phase 1 diff viewer pattern.

## Source Artifacts
- `migration-plan` — Phase 2 section
- `feature-brainstorm` — Feature #5 (Claude MCP Edit Artifact Tool, upgraded to Important)
- `pseudo-db-audit` — (context only; no direct dependency)

## 1. Structure Summary

### Files (create + modify)

**Backend**
- [ ] `src/routes/code-api.ts` — **modify** — add three POST endpoints (propose / accept / reject) and extend the envelope shape
- [ ] `src/mcp/tools/code.ts` — **modify** — add `proposeCodeEditSchema` + `handleProposeCodeEdit` handler
- [ ] `src/mcp/setup.ts` — **modify** — register `propose_code_edit` in tool list + case in dispatch switch
- [ ] `src/routes/__tests__/code-api.test.ts` — **new or modify** — integration tests for the three new endpoints

**Frontend**
- [ ] `ui/src/lib/api.ts` — **modify** — add `acceptProposedEdit()` and `rejectProposedEdit()` client methods
- [ ] `ui/src/components/editors/ProposedEditReview.tsx` — **new** — banner + integrated diff view + Accept/Reject buttons
- [ ] `ui/src/components/editors/CodeEditor.tsx` — **modify** — detect `envelope.proposedEdit`, render the review banner at the top of the editor pane

### Type Definitions

Snippet envelope gains an optional `proposedEdit` field. No shared TypeScript type exists today (the envelope is parsed ad-hoc with `JSON.parse` in each consumer), so we add the field inline wherever it's read/written. Shape:

```typescript
// Stored as JSON in snippet.content alongside existing linked-envelope fields
interface ProposedEdit {
  newCode: string;           // the full proposed file content
  message?: string;          // human-readable explanation from Claude
  proposedAt: number;        // Date.now() when the proposal was created
  proposedBy: string;        // "claude" (future-proof for other agents)
}

// Extended envelope
interface LinkedEnvelope {
  code: string;
  language: string;
  filePath: string;
  originalCode: string;
  diskCode: string;
  linked: true;
  linkCreatedAt: number;
  lastPushedAt: number | null;
  lastSyncedAt: number;
  dirty: boolean;
  proposedEdit?: ProposedEdit;  // NEW — absent when no proposal pending
}
```

### Component Interactions

```
Claude (MCP)
     │
     │  propose_code_edit(id, newCode, message)
     ▼
src/mcp/tools/code.ts::handleProposeCodeEdit
     │
     │  fetch POST /api/code/proposed-edit/:id
     ▼
src/routes/code-api.ts::handleCreateProposedEdit
     │  — validates snippet exists + is linked
     │  — validates no proposal already pending (or replaces it)
     │  — writes envelope.proposedEdit via SnippetManager.saveSnippet
     │  — broadcasts snippet_updated via wsHandler
     ▼
SessionStore (UI) receives WebSocket event
     │
     ▼
CodeEditor.tsx re-renders, re-parses envelope
     │  — envelope.proposedEdit is now populated
     ▼
ProposedEditReview.tsx renders at top of editor
     │   shows: message + inline diff (envelope.code → proposedEdit.newCode)
     │   buttons: [Accept] [Reject]
     │
     ├── Accept ─────▶ api.acceptProposedEdit()
     │                      │
     │                      ▼
     │               POST /api/code/proposed-edit/:id/accept
     │                      │  — envelope.code = proposedEdit.newCode
     │                      │  — envelope.dirty = true
     │                      │  — delete envelope.proposedEdit
     │                      │  — broadcast snippet_updated
     │                      ▼
     │               User sees updated editor content, Push button enabled
     │
     └── Reject ─────▶ api.rejectProposedEdit()
                            │
                            ▼
                     POST /api/code/proposed-edit/:id/reject
                            │  — delete envelope.proposedEdit (no other changes)
                            │  — broadcast snippet_updated
                            ▼
                     Banner disappears, editor content unchanged
```

**Key design choices:**

1. **No new MCP tools for accept/reject.** Those are strictly human actions in the UI. Claude only ever proposes.
2. **Propose replaces any pending proposal.** If Claude proposes while one is already pending, the new one overwrites. Simpler than a rejection-required queue; matches Claude's typical retry behavior.
3. **Accept does not auto-push to disk.** It just updates `envelope.code` and marks dirty. User still reviews and pushes via the existing Phase 1 flow. This preserves the two-step safety (Claude → editor review → disk push).
4. **DiffAgainstDiskModal is NOT modified.** The proposed-edit review is a separate component with its own modal/banner. Reusing `DiffAgainstDiskModal` would require threading a new `compareMode` through a component that already has two modes — the blast radius isn't worth it. Both components internally use the same `react-diff-viewer-continued` library.

---

## 2. Function Blueprints

### Backend

#### `handleCreateProposedEdit(project: string, session: string, id: string, body: { newCode: string; message?: string }): Promise<Response>`

New handler in `src/routes/code-api.ts`. Called by POST `/api/code/proposed-edit/:id`.

**Pseudocode:**
1. Validate `body.newCode` is a string (400 if not)
2. Load `SnippetManager` for the session (same pattern as `handlePushToFile`)
3. Fetch snippet by id (404 if not found)
4. Parse envelope — if `linked !== true`, return 400 "Snippet is not linked to a file"
5. Set `envelope.proposedEdit = { newCode: body.newCode, message: body.message, proposedAt: Date.now(), proposedBy: 'claude' }`
6. Serialize envelope + `saveSnippet(id, content)`
7. Broadcast `snippet_updated` event (copy the existing broadcast pattern from `handlePushToFile`)
8. Return `{ success: true, id, hasProposedEdit: true }`

**Error handling:** Snippet not found → 404. Not linked → 400. JSON parse failure → 500 with clear message. Short-circuit if `newCode` is identical to current `envelope.code` — still succeed but return `{ noop: true }` so Claude gets unambiguous feedback.

**Edge cases:**
- A proposal already exists → silently replace (overwrite). Don't error.
- `newCode` is empty string → allow (Claude may legitimately want to empty a file).
- `newCode` contains null bytes or binary data → the current pushToFile path has no such guard; matching that behavior is fine for Phase 2.

**Test strategy:**
- Happy path: linked snippet → propose → snippet has `proposedEdit` field, broadcast fired
- Not linked: returns 400
- Snippet 404
- Replace existing proposal: second propose overwrites first
- Missing `newCode`: 400

#### `handleAcceptProposedEdit(project: string, session: string, id: string): Promise<Response>`

New handler in `src/routes/code-api.ts`. Called by POST `/api/code/proposed-edit/:id/accept`.

**Pseudocode:**
1. Load SnippetManager, fetch snippet (404 if not found)
2. Parse envelope; if `!envelope.linked` → 400
3. If `!envelope.proposedEdit` → 400 "No proposed edit to accept"
4. Set `envelope.code = envelope.proposedEdit.newCode`
5. Set `envelope.dirty = envelope.code !== envelope.originalCode` (normally true; may be false if the proposal matched `originalCode` exactly)
6. Delete `envelope.proposedEdit`
7. Save + broadcast `snippet_updated`
8. Return `{ success: true, dirty: envelope.dirty }`

**Error handling:** No pending proposal → 400 (not 404 — the snippet exists).

**Edge cases:**
- Accepting while the snippet's base code has been edited in the interim: the edit is lost in favor of the proposal. Acceptable; this mirrors how Claude would overwrite a file on disk. Document in the MCP tool description.

**Test strategy:**
- Happy path: proposal present → accept → `code` equals `newCode`, `dirty=true`, no `proposedEdit`
- No proposal pending: 400
- Not linked: 400
- Proposal exactly matches `originalCode`: `dirty=false`

#### `handleRejectProposedEdit(project: string, session: string, id: string): Promise<Response>`

New handler in `src/routes/code-api.ts`. Called by POST `/api/code/proposed-edit/:id/reject`.

**Pseudocode:**
1. Load SnippetManager, fetch snippet (404 if not found)
2. Parse envelope; if `!envelope.linked` → 400
3. If `!envelope.proposedEdit` → 200 with `{ success: true, noop: true }` (idempotent; rejecting a non-existent proposal is a no-op, not an error)
4. Delete `envelope.proposedEdit`
5. Save + broadcast `snippet_updated`
6. Return `{ success: true }`

**Error handling:** Snippet 404 is the only hard error.

**Test strategy:**
- Happy path: proposal present → reject → no `proposedEdit`, code unchanged, dirty unchanged
- Idempotent: reject when none pending → 200
- Not linked: 400

#### Routing (dispatch additions in `handleCodeAPI`)

Add three path matchers alongside the existing `/push/:id` and `/sync/:id` matchers:
```typescript
if (path.match(/^\/proposed-edit\/[^/]+$/) && req.method === 'POST') { ... }
if (path.match(/^\/proposed-edit\/[^/]+\/accept$/) && req.method === 'POST') { ... }
if (path.match(/^\/proposed-edit\/[^/]+\/reject$/) && req.method === 'POST') { ... }
```
All require `session` in the query string (same guard as existing endpoints).

### MCP Tool

#### `proposeCodeEditSchema` + `handleProposeCodeEdit(project, session, id, newCode, message?)`

New additions in `src/mcp/tools/code.ts`.

**Schema:**
```typescript
export const proposeCodeEditSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Snippet ID of the linked code artifact' },
    newCode: { type: 'string', description: 'Proposed full-file content. Replaces the entire file, not a patch.' },
    message: { type: 'string', description: 'Short human-readable explanation of the proposed change.' },
  },
  required: ['project', 'session', 'id', 'newCode'],
};
```

**Handler pseudocode:**
1. Call `fetch(buildUrl('/api/code/proposed-edit/' + id, project, session), { method: 'POST', body: JSON.stringify({ newCode, message }) })`
2. If not ok, throw with the API error message (pattern copied from `handlePushCodeToFile`)
3. Return the parsed JSON response

**Error handling:** Mirrors other code tool handlers — throw on non-ok, propagate JSON errors from the API.

**Test strategy:** Manual (the other code MCP handlers don't have unit tests either; they're indirectly covered by API tests).

#### `setup.ts` registration

Two small additions in `src/mcp/setup.ts`:

1. In the tools list (around line 1985), add:
```typescript
{
  name: 'propose_code_edit',
  description: 'Propose an edit to a linked code artifact. The proposal appears in the UI as a diff with Accept/Reject buttons. Acceptance updates the in-editor code (user must still Push to write to disk). Only one proposal can be pending per snippet; a new proposal replaces any existing one.',
  inputSchema: proposeCodeEditSchema,
},
```

2. In the dispatch switch (around line 3608), add:
```typescript
case 'propose_code_edit': {
  const { project, session, id, newCode, message } = args as {
    project: string; session: string; id: string; newCode: string; message?: string;
  };
  if (!project || !session || !id || typeof newCode !== 'string') {
    throw new Error('Missing required: project, session, id, newCode');
  }
  const result = await handleProposeCodeEdit(project, session, id, newCode, message);
  return JSON.stringify(result, null, 2);
}
```

3. Add `proposeCodeEditSchema, handleProposeCodeEdit` to the existing import from `./tools/code.js`.

### Frontend

#### `api.acceptProposedEdit(project, session, id)` / `api.rejectProposedEdit(project, session, id)`

New methods in `ui/src/lib/api.ts`. Thin wrappers around `fetch`, matching the existing `pushCodeToFile` / `syncCodeFromDisk` patterns.

**Pseudocode:**
```typescript
async acceptProposedEdit(project: string, session: string, id: string): Promise<{ success: boolean; dirty: boolean }> {
  const url = `/api/code/proposed-edit/${encodeURIComponent(id)}/accept?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}
```
`rejectProposedEdit` follows the same shape.

#### `ProposedEditReview.tsx` component

New file `ui/src/components/editors/ProposedEditReview.tsx`. Renders as a sticky banner above the editor pane when a proposal is present.

**Props:**
```typescript
interface ProposedEditReviewProps {
  snippetId: string;
  projectPath: string;
  sessionName: string;
  currentCode: string;           // envelope.code
  proposedCode: string;          // envelope.proposedEdit.newCode
  proposedMessage?: string;
  proposedAt: number;
  onAccept: () => Promise<void>; // parent refreshes snippet after
  onReject: () => Promise<void>;
}
```

**Layout:**
- Top banner: amber background (`bg-amber-50 dark:bg-amber-900/30`), tall enough to show the message + two buttons. Styled similarly to the existing conflict banner at `CodeEditor.tsx:314`.
- Content: "Claude proposed: <message>" + "<relative time>" + [Preview Diff] button + [Accept] [Reject] buttons.
- Clicking [Preview Diff] opens a modal (new local state) that renders a `DiffViewer` from `react-diff-viewer-continued` comparing `currentCode` → `proposedCode`. The modal mirrors `DiffAgainstDiskModal.tsx`'s structure but is simpler (no compare-mode toggle, no disk fetch — it already has the strings).
- Accept/Reject buttons call the parent handlers, which refresh the snippet.

**Pseudocode of the component:**
1. Local state: `isProcessing` (bool), `previewOpen` (bool)
2. Handle Accept: set `isProcessing=true` → `await onAccept()` → reset state (parent will unmount us after snippet refreshes)
3. Handle Reject: same pattern with `onReject()`
4. Buttons disabled while `isProcessing`
5. Preview modal renders inline when `previewOpen`, reusing Tailwind classes from `DiffAgainstDiskModal`

**Error handling:** If Accept/Reject throws, reset `isProcessing` and surface a flash message. Parent's refresh will reconcile any stale state.

**Edge cases:**
- `proposedCode === currentCode`: the diff viewer shows "No changes detected" and Accept still works (it just normalizes state by removing `proposedEdit`).
- Rapid successive proposals: the WebSocket refresh re-mounts the banner with new props; in-flight accept/reject complete against the snippet ID regardless of content change.

**Test strategy:** Manual — no component tests exist for CodeEditor siblings. Exercise via the live collab UI.

#### `CodeEditor.tsx` integration

Modifications in `ui/src/components/editors/CodeEditor.tsx`:

1. **Extend the envelope parser.** In `parseLinkedEnvelope` (line 45), also extract `proposedEdit`:
```typescript
proposedEdit: (data.proposedEdit && typeof data.proposedEdit.newCode === 'string')
  ? {
      newCode: data.proposedEdit.newCode,
      message: typeof data.proposedEdit.message === 'string' ? data.proposedEdit.message : undefined,
      proposedAt: typeof data.proposedEdit.proposedAt === 'number' ? data.proposedEdit.proposedAt : Date.now(),
    }
  : null,
```
Also extend the return type to include `code` (we need it to pass to the review component, and it's not currently extracted).

2. **Add handlers:**
```typescript
const handleAcceptProposal = useCallback(async () => {
  if (!currentSession) return;
  try {
    await api.acceptProposedEdit(currentSession.project, currentSession.name, snippetId);
    setFlashMessage('Accepted — review and Push when ready');
    await refreshSnippet();
  } catch (err) {
    console.error('Accept failed:', err);
    setFlashMessage('Accept failed');
  }
}, [currentSession, snippetId, refreshSnippet]);

const handleRejectProposal = useCallback(async () => {
  if (!currentSession) return;
  try {
    await api.rejectProposedEdit(currentSession.project, currentSession.name, snippetId);
    setFlashMessage('Rejected');
    await refreshSnippet();
  } catch (err) {
    console.error('Reject failed:', err);
    setFlashMessage('Reject failed');
  }
}, [currentSession, snippetId, refreshSnippet]);
```

3. **Render the banner.** Insert above the existing conflict banner (around line 313), inside the outer `flex flex-col h-full`:
```tsx
{envelope.proposedEdit && currentSession && (
  <ProposedEditReview
    snippetId={snippetId}
    projectPath={currentSession.project}
    sessionName={currentSession.name}
    currentCode={envelope.code}
    proposedCode={envelope.proposedEdit.newCode}
    proposedMessage={envelope.proposedEdit.message}
    proposedAt={envelope.proposedEdit.proposedAt}
    onAccept={handleAcceptProposal}
    onReject={handleRejectProposal}
  />
)}
```

4. **Update `useMemo` deps.** The `mergedControls` useMemo (line 294) does not need to know about `proposedEdit` — the banner is rendered separately. Verify the toolbar continues to render correctly while a proposal is pending.

**Edge cases:**
- Proposal pending + conflict state simultaneously: render both banners (proposal above conflict). Visual stacking is fine; acceptable during Phase 2 and easy to refine later.
- Snippet is in the PseudoSideBySideView wrapper: the banner should still appear above the split pane. It sits above the `flex-1 min-h-0` container, so this works naturally.

**Test strategy:** Manual end-to-end:
1. Link a file → Claude proposes → banner appears immediately via WebSocket
2. Click Preview Diff → modal shows diff correctly
3. Click Accept → banner disappears, editor content updated, Push button enabled
4. Link another file → Claude proposes → click Reject → banner disappears, editor unchanged
5. Exercise with the Pseudo side-by-side view on and off

### Backend Tests

#### `src/routes/__tests__/code-api.test.ts` additions

Check if the test file exists. If not, create it following the pattern of `src/routes/__tests__/snippets.test.ts` (we know it exists from the earlier grep). Add a new describe block `'/api/code/proposed-edit'` with:

1. `POST /proposed-edit/:id` — happy path creates proposedEdit on envelope
2. `POST /proposed-edit/:id` — 400 when snippet not linked
3. `POST /proposed-edit/:id` — 404 when snippet missing
4. `POST /proposed-edit/:id` — replaces existing proposedEdit
5. `POST /proposed-edit/:id/accept` — moves newCode into envelope.code, sets dirty, clears proposedEdit
6. `POST /proposed-edit/:id/accept` — 400 when no proposal pending
7. `POST /proposed-edit/:id/reject` — clears proposedEdit, no other changes
8. `POST /proposed-edit/:id/reject` — idempotent when no proposal pending (200, noop)

**Note on broadcast testing:** The existing snippet tests assert the broadcast event *shape* without an actual WebSocket. Match that pattern — don't try to verify delivery, just verify the envelope payload.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: backend-endpoints
    files:
      - src/routes/code-api.ts
    tests:
      - src/routes/__tests__/code-api.test.ts
    description: "Add POST /api/code/proposed-edit/:id, /accept, and /reject endpoints. Extend envelope with optional proposedEdit field. Broadcast snippet_updated on all three."
    parallel: true
    depends-on: []

  - id: mcp-propose-tool
    files:
      - src/mcp/tools/code.ts
      - src/mcp/setup.ts
    tests: []
    description: "Add proposeCodeEditSchema + handleProposeCodeEdit that fetches POST /api/code/proposed-edit/:id. Register propose_code_edit tool in setup.ts tool list and dispatch switch."
    parallel: true
    depends-on: [backend-endpoints]

  - id: ui-api-client
    files:
      - ui/src/lib/api.ts
    tests: []
    description: "Add acceptProposedEdit() and rejectProposedEdit() client methods matching the pushCodeToFile pattern."
    parallel: true
    depends-on: [backend-endpoints]

  - id: backend-tests
    files:
      - src/routes/__tests__/code-api.test.ts
    tests:
      - src/routes/__tests__/code-api.test.ts
    description: "Integration tests for propose/accept/reject endpoints. Covers happy paths, not-linked, missing snippet, replace-existing, idempotent reject."
    parallel: true
    depends-on: [backend-endpoints]

  - id: ui-review-component
    files:
      - ui/src/components/editors/ProposedEditReview.tsx
    tests: []
    description: "New banner component: amber top bar with proposal message + Preview Diff modal (reusing react-diff-viewer-continued) + Accept/Reject buttons. Calls parent handlers which refresh the snippet."
    parallel: false
    depends-on: [ui-api-client]

  - id: ui-codeeditor-integration
    files:
      - ui/src/components/editors/CodeEditor.tsx
    tests: []
    description: "Extend parseLinkedEnvelope to extract proposedEdit and code. Add handleAcceptProposal / handleRejectProposal callbacks. Render ProposedEditReview banner above existing conflict banner when envelope.proposedEdit is present."
    parallel: false
    depends-on: [ui-review-component]
```

### Execution Waves

**Wave 1 (1 task):**
- `backend-endpoints`

**Wave 2 (3 parallel tasks):**
- `mcp-propose-tool`
- `ui-api-client`
- `backend-tests`

**Wave 3 (1 task):**
- `ui-review-component`

**Wave 4 (1 task):**
- `ui-codeeditor-integration`

### Summary
- Total tasks: 6
- Total waves: 4
- Max parallelism: 3 (Wave 2)

---

## 4. Out of Scope / Deferred

- **MCP accept/reject tools.** Accept/Reject stay UI-only. If Claude needs to know the outcome it can call `review_code_edits` afterward.
- **Multi-proposal queue.** A new propose replaces the existing one. No history of rejected proposals.
- **Automatic Push on Accept.** The user must still manually Push to write to disk — this preserves the two-step safety net.
- **Rich diff annotations** (review comments, line-level suggestions). Out of scope for Phase 2.
- **Shared TypeScript envelope type.** The envelope shape is still parsed inline per-consumer. A future refactor to lift it into `src/types/linked-envelope.ts` would pay dividends once Phase 3+ adds more fields — but would bloat Phase 2's blast radius.
- **Collision with existing `dirty` state on accept.** If the user has unsaved in-editor edits when Claude proposes, the proposal's newCode is relative to the saved snippet content, not the in-editor buffer. Accept will overwrite any in-flight typing. The SnippetEditor autosaves to the backend fast enough that this is rare in practice; flagging as a known minor edge for Phase 2.

---

## 5. Validation

At the end of Phase 2 the following must work end-to-end:

1. **MCP call → WebSocket → UI banner.** Claude calls `propose_code_edit` and the banner appears in the running UI within one tick without a manual refresh.
2. **Accept flow.** Clicking Accept replaces `envelope.code` with `proposedEdit.newCode`, marks the snippet dirty, removes the proposal, and the existing Phase 1 Push button lights up. Clicking Push then writes to disk via the unchanged Phase 1 path.
3. **Reject flow.** Clicking Reject removes the proposal with zero other side effects. Editor content and `dirty` state are untouched.
4. **Preview Diff.** The Preview Diff modal shows the correct inline diff between current `code` and proposed `newCode`, matching what Accept would apply.
5. **Replace semantics.** A second `propose_code_edit` on the same snippet overwrites the first without error.
6. **Not-linked guard.** Proposing on a plain (non-linked) snippet returns 400.
7. **Tests green.** `npm run test:ci -- code-api` passes the new suite.
8. **No regressions.** Phase 1 features (Diff Against Disk, Kebab Menu, Pseudo side-by-side) still work unchanged.
