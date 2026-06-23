# Bug Review

Git range: 47ad3bf..0edbe02

Files reviewed: src/routes/code-api.ts, src/mcp/tools/code.ts, src/websocket/handler.ts, ui/src/components/editors/CodeEditor.tsx, ui/src/components/editors/SnippetEditor.tsx, ui/src/components/editors/UnifiedEditor.tsx, ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx, ui/src/lib/promote-code-file.ts

---

## Bug 1 — linesAdded/linesRemoved counts total lines, not changed lines

**Severity: Minor**
**File:** `src/routes/code-api.ts` — `handleAcceptProposedEdit` (~line 684) and `handleRejectProposedEdit` (~line 756)

**What's wrong:**

```ts
linesAdded: decisionInfo.newCode ? decisionInfo.newCode.split('\n').length : 0,
linesRemoved: oldCode ? oldCode.split('\n').length : 0,
```

Both `linesAdded` and `linesRemoved` count the total line count of the whole file, not the actual diff delta. For a 500-line file with a 2-line change, this logs `linesAdded: 500, linesRemoved: 500`, which is meaningless and misleading for the edit-decisions log. The same mistake is repeated in `handleRejectProposedEdit`.

The field names imply a diff metric (added vs removed lines), not a file-size metric.

**Fix:** Compute a real line diff, or rename the fields to `newCodeLines` / `oldCodeLines` to accurately reflect what they measure. A minimal correct diff count:

```ts
const newLines = (decisionInfo.newCode ?? '').split('\n').length;
const oldLines = (oldCode ?? '').split('\n').length;
linesAdded: Math.max(0, newLines - oldLines),
linesRemoved: Math.max(0, oldLines - newLines),
```

---

## Bug 2 — `appendEditDecision` double-wraps its own error silencing, but `handleRecordEditDecision` still `await`s it with no protection

**Severity: Minor**
**File:** `src/routes/code-api.ts` — `handleRecordEditDecision` (~line 810) and `appendEditDecision` (~line 771)

**What's wrong:**

`appendEditDecision` internally has a `try/catch` that logs and swallows all errors — it never throws. The callers in `handleAcceptProposedEdit` and `handleRejectProposedEdit` wrap their calls in an additional `try/catch`, which is harmless redundancy.

However, `handleRecordEditDecision` calls `await appendEditDecision(...)` **without** any try/catch at all. If `appendEditDecision`'s internal `try` were ever refactored to throw (e.g. the outer function is already wrapped), the unhandled rejection would propagate up and crash the request handler. This is currently safe only because of the inner swallow — but it's a fragile dependency on implementation details that could break under future refactoring.

**Fix:** Either (a) add a try/catch in `handleRecordEditDecision` consistent with the other two callers, or (b) remove the redundant try/catch from the other two callers and let the outer request error boundary handle it uniformly.

---

## Bug 3 — `PseudoTreeBody` prefetch guard uses `find` (O(n)) on every hover, with `toRelative` called twice per item

**Severity: Minor**
**File:** `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx` — `handleTreePrefetch` (~line 100–108)

**What's wrong:**

```ts
const meta = fileList.find((f) => toRelative(f.filePath) === relPath);
```

The component already builds a `fileMeta` map (`Map<string, PseudoFileSummary>`) keyed by `toRelative(f.filePath)` for exactly this lookup purpose. The new guard ignores that map and does a linear O(n) scan instead, calling `toRelative` once per item on every hover event. With large file lists this is wasteful.

**Fix:** Use the existing `fileMeta` map:

```ts
const handleTreePrefetch = useCallback(
  (relPath: string) => {
    if (!project) return;
    const meta = fileMeta.get(relPath);
    if (!meta || (meta.methodCount === 0 && meta.exportCount === 0)) return;
    const abs = relativeToAbsolute.get(relPath) ?? relPath;
    prefetchPseudoFile(project, abs);
  },
  [project, relativeToAbsolute, fileMeta]
);
```

---

## Bug 4 — `handleWaitForEditDecision` conflates `'replaced'` rejection with generic errors, returning misleading `'cancelled'`

**Severity: Minor**
**File:** `src/mcp/tools/code.ts` — `handleWaitForEditDecision` (~line 270–290)

**What's wrong:**

```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'edit_decision_timeout') {
    return { content: [{ type: 'text', text: JSON.stringify({ decision: 'timeout' }) }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify({ decision: 'cancelled' }) }], isError: true };
}
```

`EditDecisionBridge.wait()` can reject with three distinct error messages: `'edit_decision_timeout'`, `'replaced'`, and `'edit_decision_cancelled'`. The handler only distinguishes `timeout`; all other cases including `'replaced'` (which fires when a new proposal supersedes an old one while the agent is still waiting) are silently collapsed into `{ decision: 'cancelled' }`. The agent cannot distinguish "user cancelled" from "a new proposal replaced the one I was waiting on", which could cause incorrect agent behaviour in pair-mode flows.

**Fix:** Add an explicit branch for `'replaced'`:

```ts
if (msg === 'edit_decision_timeout') {
  return { content: [{ type: 'text', text: JSON.stringify({ decision: 'timeout' }) }], isError: true };
}
if (msg === 'replaced') {
  return { content: [{ type: 'text', text: JSON.stringify({ decision: 'replaced' }) }], isError: true };
}
return { content: [{ type: 'text', text: JSON.stringify({ decision: 'cancelled' }) }], isError: true };
```

---

## Bug 5 — `promote-code-file.ts` searches `s.content` for `filePath`, but linked snippets store it in the envelope's `filePath` field while plain snippets store different JSON — parse errors silently skip matches

**Severity: Minor**
**File:** `ui/src/lib/promote-code-file.ts` (~line 31–40)

**What's wrong:**

The deduplication loop tries to find an already-linked snippet by matching `parsed?.filePath === absPath`. This is correct for the linked envelope format (`{ code, filePath, linked: true, ... }`). However, the loop continues on parse failure (correct), but it also silently skips snippets where `parsed.filePath` is undefined — e.g. plain text snippets where the JSON has a `content` field but no `filePath`. This is functionally fine but the comment should note that only linked snippets have `filePath`.

More concretely: if `absPath` is constructed from a relative `stem` that begins with the project prefix *with* a trailing slash that was already stripped, the join `${project.replace(/\/$/, '')}/${stem}` could double-concatenate if `stem` itself contains a leading slash from a different code path. This is an edge-case path construction issue that could cause the dedup check to miss the existing snippet, resulting in a duplicate `linkFile` call. The `linkFile` function has its own inflight dedup, so this would not create two snippets, but the `closeTab`/`openPermanent` flow would proceed with the newly-linked ID rather than the already-open ID.

**Fix:** Normalize `absPath` through `new URL` or an explicit path join rather than string concatenation to guarantee no double-slash or double-prefix:

```ts
import { resolve } from 'path'; // or use a URL-safe join
const absPath = resolve(currentSession.project, stem);
```

---

## Summary

5 bugs found. None are Critical. All are Minor with the exception of Bug 4, which is Important in pair-mode workflows where the agent needs to correctly distinguish a superseded proposal from a cancelled one.

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Minor | src/routes/code-api.ts | linesAdded/linesRemoved = total lines, not diff delta |
| 2 | Minor | src/routes/code-api.ts | handleRecordEditDecision missing try/catch around appendEditDecision |
| 3 | Minor | ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx | O(n) find instead of existing fileMeta map |
| 4 | Important | src/mcp/tools/code.ts | 'replaced' rejection collapsed into 'cancelled' — agent loses signal |
| 5 | Minor | ui/src/lib/promote-code-file.ts | String-concat path construction may produce double-prefix for relative stems |
