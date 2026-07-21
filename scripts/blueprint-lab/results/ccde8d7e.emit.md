I have a complete picture. The history **view** already ships (`HistoryDropdown`, `HistoryModal`, `HistoryToolbar`, per-resource dropdowns) and the server already has `/history` + `/version` endpoints backed by `UpdateLogManager`. What is missing is the **restore path** and a **lossless** reconstruction guarantee. Here is the blueprint.

---

## Blueprint — History view + restore path (lossless round-trip)

### Problem, grounded in the code

1. **Reconstruction is lossy.** `UpdateLogManager.replayToTimestamp` (`src/services/update-log-manager.ts:113`) rebuilds a version with:
   ```ts
   content = content.replace(change.diff.oldString, change.diff.newString);
   ```
   `String.prototype.replace` with a **string** pattern (a) treats `$&`, `$1`, `$$`, `` $` ``, `$'` in `newString` as replacement directives, and (b) only replaces the *first* occurrence. Any document whose content contains a `$` (prices, shell snippets, regex, LaTeX) does **not** round-trip. This is the crux of "lossless round-trip".

2. **No restore path exists.** `onVersionSelect` in `HistoryDropdown`/`HistoryToolbar` only *previews* a version into a viewer; nothing writes a historical version back as the live content. `HistoryModal` (`ui/src/components/editors/HistoryModal.tsx`) has only a **Close** button in its footer (`:157-163`). There is no `/restore` route in `src/routes/api.ts` (grep for `restore` finds only the unrelated collapse-split undo).

### Change shape

**1. Lossless replay — `src/services/update-log-manager.ts`**
Rewrite the apply-step inside the `for` loop of `replayToTimestamp` (currently `:108-118`) to avoid `$`-interpretation and stay deterministic (matching the first-occurrence semantics the patch was written with):
```ts
if (changeTime <= targetTime) {
  const { oldString, newString } = change.diff;
  if (content === oldString) {
    content = newString;                    // whole-content diff (the common case) — exact
  } else {
    const idx = content.indexOf(oldString);
    if (idx !== -1) {
      content = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    }
  }
} else {
  break;
}
```
`indexOf` + `slice` splices the literal `newString` (no `$` expansion) at the first match — lossless.

**2. Restore endpoint — `src/routes/api.ts`**
Add `POST /api/document/:id/restore?project=…&session=…` (place it beside the existing document `/version` handler, before the generic `POST /api/document/:id` update at `:1879` so the more specific path wins). Body `{ timestamp }`. It:
- resolves `sessionPath` the same way `/version` does (`sessionRegistry.resolvePath(...,'documents')` → `join(documentsPath,'..')`),
- `const content = await updateLogManager.replayToTimestamp('documents', id, timestamp)`,
- reads old content, `documentManager.saveDocument(id, content)`, then `updateLogManager.logUpdate('documents', id, oldContent, content)` so the restore is itself recorded (history stays append-only — the "round-trip"),
- broadcasts `document_updated` and `document_history_updated` exactly like the update handler at `:1916-1940`,
- returns `Response.json({ success: true, content })`; 404 when `replayToTimestamp` throws `No history found` (mirror `:1832`).

**3. Client method — `ui/src/lib/api.ts`**
Add `restoreDocument(project, session, id, timestamp)` next to `updateDocument` (`:373`), POSTing `{ timestamp }` to `/api/document/${id}/restore?project&session`, returning the parsed `{ content }`.

**4. Modal restore affordance — `ui/src/types/history.ts` + `ui/src/components/editors/HistoryModal.tsx`**
- Add optional `onRestore?: (timestamp: string, content: string) => void` to `HistoryModalProps` (`ui/src/types/history.ts:45-58`).
- In `HistoryModal.tsx` footer (`:152-164`), when `onRestore` is provided render a primary **"Restore this version"** button (`data-testid="history-modal-restore-btn"`) that calls `onRestore(timestamp, historicalContent)` then `onClose()`. Close button stays.

**5. Wire restore into the editor — `ui/src/components/editors/DocumentEditor.wysiwyg.tsx`**
Add a `handleRestore` callback that calls `api.restoreDocument(project, session, document.id, timestamp)`, then `setContent`, `latestMarkdownRef.current = content`, `milkdownHandleRef.current?.setMarkdown(content)`, `setHasChanges(false)`, and `updateDocument(...)` so the store echoes the restored text. Pass it as `onRestore` to the `<HistoryModal>` at `:360-367`.

### Tests

- **`src/services/__tests__/update-log-manager.test.ts` (new, bun:test):** build a manager over an `mkdtempSync` dir, `logUpdate('documents', id, orig, next)` where `next` contains `$&`/`$1`/`$100`, then assert `replayToTimestamp(...)` returns `next` **exactly** — the regression that `.replace` fails.
- **`ui/src/components/editors/__tests__/HistoryModal.test.tsx` (edit):** add a test that, given `onRestore`, renders the restore button and clicking it calls `onRestore` with `(timestamp, historicalContent)` then `onClose`.

### Acceptance criteria (positive, citable)
- `src/services/update-log-manager.ts` `replayToTimestamp` splices via `indexOf`/`slice` (or whole-content assignment) instead of `String.replace` — pointable at the rewritten loop body.
- `src/routes/api.ts` contains a `POST .../restore` handler that replays + saves + rebroadcasts.
- `ui/src/lib/api.ts` exports `restoreDocument`.
- `ui/src/types/history.ts` `HistoryModalProps` declares `onRestore`.
- `ui/src/components/editors/HistoryModal.tsx` renders `history-modal-restore-btn` gated on `onRestore`.
- The two named tests above pass.

### Out of scope (noted, not criteria)
- Diagram/design/spreadsheet/snippet restore endpoints (documents only this leaf; same pattern later).
- Changing the on-write diff format or `logUpdate`.
- Restore wiring in the legacy `DocumentEditor.legacy.tsx`.

```json
{ "schemaVersion": 2, "estimatedFiles": 8, "estimatedTasks": 6,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/__tests__/update-log-manager.test.ts"],
  "filesToEdit": ["src/services/update-log-manager.ts", "src/routes/api.ts", "ui/src/lib/api.ts", "ui/src/types/history.ts", "ui/src/components/editors/HistoryModal.tsx", "ui/src/components/editors/DocumentEditor.wysiwyg.tsx", "ui/src/components/editors/__tests__/HistoryModal.test.tsx"],
  "tasks": [
    { "id": "lossless-replay", "files": ["src/services/update-log-manager.ts"], "description": "Rewrite replayToTimestamp apply-step to indexOf/slice splice + whole-content fast path (no String.replace $-expansion)" },
    { "id": "restore-endpoint", "files": ["src/routes/api.ts"], "description": "Add POST /api/document/:id/restore that replays to timestamp, saves back, logs, and rebroadcasts" },
    { "id": "restore-client", "files": ["ui/src/lib/api.ts"], "description": "Add restoreDocument client method posting {timestamp} to the restore route" },
    { "id": "modal-restore-ui", "files": ["ui/src/types/history.ts", "ui/src/components/editors/HistoryModal.tsx"], "description": "Add onRestore prop and a Restore-this-version button to HistoryModal" },
    { "id": "editor-wire-restore", "files": ["ui/src/components/editors/DocumentEditor.wysiwyg.tsx"], "description": "Wire handleRestore into HistoryModal via onRestore to update editor + store content" },
    { "id": "tests", "files": ["src/services/__tests__/update-log-manager.test.ts", "ui/src/components/editors/__tests__/HistoryModal.test.tsx"], "description": "Lossless round-trip test for $-bearing content and modal restore-button test" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "named-test", "testFile": "src/services/__tests__/update-log-manager.test.ts", "testName": "replayToTimestamp round-trips content containing $ sequences losslessly", "mechanical": true },
    { "kind": "named-test", "testFile": "ui/src/components/editors/__tests__/HistoryModal.test.tsx", "testName": "renders Restore button and calls onRestore with historical content", "mechanical": true },
    { "kind": "symbol-present", "file": "ui/src/lib/api.ts", "symbol": "restoreDocument", "description": "Client method that POSTs a timestamp to the document restore route" },
    { "kind": "symbol-present", "file": "ui/src/types/history.ts", "symbol": "onRestore", "description": "Optional restore callback on HistoryModalProps that drives the restore path" },
    { "kind": "threshold", "source": "grep-count", "metric": "document-restore-route", "comparison": "gte", "value": 1, "mechanical": true }
  ],
  "outOfScope": ["Diagram/design/spreadsheet/snippet restore endpoints", "Changing the on-write diff/patch format or logUpdate", "Restore wiring in DocumentEditor.legacy.tsx"] }
```