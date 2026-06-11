# Bug Review

## Bug 1 — Query param mismatch: frontend sends `path`, backend reads `dir`

**Severity:** Critical  
**File:** `ui/src/lib/api.ts` line 762 vs `src/routes/code-api.ts` line 41  
**What's wrong:** The frontend `listProjectFiles` sets the query parameter as `path`:
```ts
if (dirPath) params.set('path', dirPath);
```
But the backend `handleCodeAPI` reads it as `dir`:
```ts
const dirPath = url.searchParams.get('dir') || undefined;
```
This means subdirectory browsing in the FileBrowserDialog will never work — clicking a folder will always load the project root instead of the subdirectory contents.  
**Fix:** In `ui/src/lib/api.ts` line 762, change `params.set('path', dirPath)` to `params.set('dir', dirPath)`.

---

## Bug 2 — Timestamp type mismatch: ISO strings vs epoch numbers

**Severity:** Important  
**Files:** `src/routes/code-api.ts` lines 172, 251 vs `src/mcp/tools/code.ts` lines 132-133 vs `ui/src/components/editors/CodeEditor.tsx` lines 49-50  
**What's wrong:** There are two code paths that create/update envelopes with inconsistent timestamp formats:
- **MCP tool** (`code.ts` line 133): sets `lastSyncedAt: Date.now()` (epoch number) and `lastPushedAt: null`
- **REST API** (`code-api.ts` line 172): sets `lastPushedAt = new Date().toISOString()` (ISO string); line 251: sets `lastSyncedAt = new Date().toISOString()` (ISO string)
- **CodeEditor parser** (line 49-50): checks `typeof data.lastPushedAt === 'number'` and `typeof data.lastSyncedAt === 'number'`

After a push or sync via the REST API, `lastPushedAt` and `lastSyncedAt` become ISO strings. The CodeEditor parser rejects non-number values, so `lastPushedAt` will always show as `null` and `lastSyncedAt` will fall back to `Date.now()` after any push/sync operation. The status bar will show "Never pushed" even after a successful push, and sync time will reset to "just now" on every render.  
**Fix:** Either:
- (a) Change `code-api.ts` to use `Date.now()` instead of `new Date().toISOString()` on lines 172 and 251, OR
- (b) Update CodeEditor's `parseLinkedEnvelope` to accept both string and number types, parsing ISO strings with `new Date(val).getTime()`

---

## Bug 3 — Sidebar `handleLinkFile` creates empty envelope, sync may not populate code

**Severity:** Important  
**File:** `ui/src/components/layout/Sidebar.tsx` lines ~266-289 (in the diff's added code)  
**What's wrong:** The `handleLinkFile` callback creates a snippet with an envelope where `code`, `originalCode`, and `diskCode` are all empty strings. It then calls `api.syncCodeFromDisk` to populate from disk. However, in `code-api.ts` `handleSyncFromDisk` (line 244):
```ts
const diskChanged = diskContent !== (envelope.diskCode ?? '');
```
Since `diskCode` is `''` and the file on disk has content, `diskChanged` will be `true`. And `hasLocalEdits` (line 246):
```ts
const hasLocalEdits = (envelope.code ?? '') !== (envelope.originalCode ?? '');
```
Both are `''`, so `hasLocalEdits = false`. This means the auto-sync path on line 254-257 fires correctly and populates `code` and `originalCode`. So the sync logic itself works.

However, there is a subtle issue: the `handleLinkFile` function does not `await` the result of `syncCodeFromDisk` in a way that refreshes the local store. After the sync completes on the server, the Sidebar relies on WebSocket broadcast to update the UI. If WebSocket delivery is delayed or the snippet store doesn't process the update before the user clicks on the new snippet, they may briefly see an empty editor. This is a **minor** race condition rather than a logic bug.

**Severity downgraded to:** Minor  
**Fix:** After `api.syncCodeFromDisk`, explicitly fetch the updated snippet and update the store, or ensure the WebSocket handler triggers a re-render.

---

## Bug 4 — `handleTakeDisk` does not actually overwrite local edits with disk content

**Severity:** Important  
**File:** `ui/src/components/editors/CodeEditor.tsx` lines 145-149  
**What's wrong:** When a conflict is detected and the user clicks "Take Disk", the handler just clears the conflict state and calls `refreshSnippet()`. But `refreshSnippet` only re-reads the snippet from the server — it does not trigger another sync. The sync that detected the conflict (line 254 in `code-api.ts`) did NOT auto-update `code` because `hasLocalEdits` was true (that's why it was a conflict). So after "Take Disk", the snippet still has the user's local edits in `envelope.code`, not the disk content. The user expects "Take Disk" to replace their edits with the file from disk, but it doesn't.  
**Fix:** `handleTakeDisk` should call `api.syncCodeFromDisk` again, or better, call a dedicated endpoint/action that forces `envelope.code = envelope.diskCode` and `envelope.originalCode = envelope.diskCode` on the server side, then refresh.

---

## Bug 5 — FileBrowserDialog response shape mismatch

**Severity:** Minor  
**File:** `ui/src/components/dialogs/FileBrowserDialog.tsx` line 106 and line 146  
**What's wrong:** The backend `handleListProjectFiles` returns `{ entries: [...] }`, but the FileBrowserDialog reads `result.files || result || []`. Since there is no `files` property, `result.files` is `undefined`, so it falls through to `result` which is `{ entries: [...] }` — an object, not an array. The `.map()` call on an object will fail or produce no results.  
**Fix:** Change `result.files || result || []` to `result.entries || []` on both lines 106 and 146.

---

## Summary

| # | Severity | Bug |
|---|----------|-----|
| 1 | Critical | Query param mismatch `path` vs `dir` breaks subdirectory browsing |
| 2 | Important | ISO string vs epoch number timestamps break CodeEditor status display |
| 3 | Minor | Race condition on link — empty editor briefly visible |
| 4 | Important | "Take Disk" conflict resolution does not actually apply disk content |
| 5 | Critical | Response shape mismatch `entries` vs `files` breaks FileBrowserDialog entirely |
