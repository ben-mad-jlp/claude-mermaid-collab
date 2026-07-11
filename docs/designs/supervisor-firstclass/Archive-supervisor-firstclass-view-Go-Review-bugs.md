# Bug Review — supervisor-firstclass

## Summary

6 bugs found: 1 Critical, 3 Important, 2 Minor.

---

## Critical

### 1. `roadmapToMermaid.ts` — graph mode emits child nodes both inside and outside subgraph (duplicate node IDs crash Mermaid)
**File:** `ui/src/components/supervisor/roadmapToMermaid.ts` lines 111–118  
**Severity:** Critical

In `graph` mode, `topLevel` is built from items whose `parentId` is absent or not in the map. All remaining items with a valid `parentId` are rendered inside a subgraph. Then edges are emitted for **all** items (`edgeLines(items)` receives the full list, line 80).

The bug is that the `topLevel` loop (line 111) and the `childrenByParent` subgraph loop (lines 112–118) are **both** appended to `out`, but the parent node itself is emitted in both places: once as a top-level node (line 111) and again as the subgraph header on line 115 — Mermaid treats those as two separate node definitions with the same ID when the subgraph id matches a node id. More importantly, `edgeLines` emits edges for child nodes using their sanitized IDs, but those IDs only exist inside the subgraph; Mermaid requires cross-subgraph edges to be declared after all subgraphs, which `out.push(...edges)` does do (line 122) — that part is fine. The real crash: for any item that is a parent **and** appears in `topLevel` (e.g. an item whose own `parentId` is absent), `nodeLine(item, '  ')` is written on line 111, then `subgraph ${sanitizeId(pid)}` is written on line 115 using the **same sanitized id**. Mermaid does not allow a node ID to also be a subgraph ID — it will either produce a parse error or silently drop edges.

**Fix:** In graph mode, only emit `nodeLine` for items that are neither parents nor children — i.e. leaf top-level nodes. For items that have children, emit only the subgraph (not a bare node line).

```ts
for (const item of topLevel) {
  if (!childrenByParent.has(item.id)) {   // not a parent — safe to emit as node
    out.push(nodeLine(item, '  '));
  }
}
for (const [pid, children] of childrenByParent) {
  // parent is rendered as subgraph header only
  const parent = byId.get(pid);
  const label = escapeLabel(parent ? parent.title : pid);
  out.push(`  subgraph ${sanitizeId(pid)}["${label}"]`);
  for (const child of children) out.push(nodeLine(child, '    '));
  out.push('  end');
}
```

---

## Important

### 2. `EscalationInbox.tsx` — `loadEscalations` in dependency array causes infinite re-fetch loop
**File:** `ui/src/components/supervisor/EscalationInbox.tsx` line 35  
**Severity:** Important

```tsx
useEffect(() => {
  void loadEscalations(serverId, status);
}, [serverId, statusFilter, loadEscalations]);
```

`loadEscalations` is a function created inline in `create<SupervisorState>((set, get) => ({ ... }))`. Zustand does **not** memoize store actions — a new function reference is returned on every render when destructured via `useSupervisorStore()` (line 27). Because `loadEscalations` is in the deps array, every render causes a new effect → fetch → `set({ escalations })` → re-render → new `loadEscalations` ref → effect again, causing an infinite loop.

**Fix:** Select the action with a stable selector (Zustand actions are stable when selected individually):

```tsx
const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
```

This is already the pattern used in `RoadmapPanel.tsx` (line 63–64) and `SupervisedSessions.tsx` (line 24–26) which correctly select actions individually. `EscalationInbox` uses destructuring (line 27) which loses stability.

### 3. `supervisor-routes.ts` — nudge endpoint: peer `result` may have `.sent` undefined, falling back to local `sent` check wrong field name
**File:** `src/routes/supervisor-routes.ts` lines 174–181  
**Severity:** Important

For the peer path, success is determined by:
```ts
sent = !!(result?.tmux ?? result?.success);
```
But `result` comes from `peer.baseUrl + '/api/ide/tmux-send-keys'` — that endpoint returns `{ sent: boolean }` (matching the local path's response shape). Checking `result?.tmux ?? result?.success` will always be falsy, so `sent` will always be `false` for peer nudges even when they succeed. The broadcast will incorrectly report `sent: false`.

**Fix:** Use `result?.sent` for the peer path too, mirroring the local path:
```ts
sent = !!result?.sent;
```

### 4. `roadmapToMermaid.ts` `computeWaveMap` — infinite loop on self-referencing items
**File:** `ui/src/components/supervisor/roadmapToMermaid.ts` lines 58–72  
**Severity:** Important

`computeWaveMap` uses a Bellman-Ford-style relaxation loop capped at `items.length` passes (line 58). On each pass it iterates every item. For an item with `dependsOn: [item.id]` (self-loop), `deps` after filtering contains the self-reference, `maxDepWave = waveMap.get(item.id)`, so `desired = currentWave + 1` — always `> currentWave` — `changed` stays `true` every pass. The loop runs the full `items.length` passes before exiting, which is O(n²) and produces an arbitrarily inflated wave number for self-looping nodes. It doesn't infinite-loop (the cap saves it), but the output diagram will have wave numbers up to `items.length - 1` for self-referencing items, which is very misleading.

Note: `computeWaves` in `roadmap-store.ts` correctly pre-filters self-deps via `byId.has(d)` where `d !== item.id`. `computeWaveMap` should do the same.

**Fix:**
```ts
const deps = (item.dependsOn ?? []).filter((d) => idSet.has(d) && d !== item.id);
```

---

## Minor

### 5. `App.tsx` — escalation toast handler always `return`s, swallowing subsequent WebSocket messages of the same turn
**File:** `ui/src/App.tsx` line ~524  
**Severity:** Minor

```ts
if ((message as any).type === 'escalation_created') {
  // ...
  return;
}
```

The `return` exits the outer WebSocket message handler entirely. This is correct if each WS event is a single message, but the handler appears to be inside the same `switch`/if-chain that handles all message types. If the intent was to skip the `if (!currentSession) return` guard below, the `return` should instead be a named `break` or the toast logic moved above the guard and not `return`. As written it means `escalation_created` events that arrive while a session is active will never reach the `switch (message.type)` below — but since `escalation_created` has no arm in that switch, the behavior is identical. Low risk, but semantically misleading.

**Fix:** Replace `return` with an early-exit via a labeled block, or add a comment explaining this is intentional.

### 6. `SupervisedSessions.tsx` — `handleNudge` always sends hardcoded text `'continue'`
**File:** `ui/src/components/supervisor/SupervisedSessions.tsx` line 74  
**Severity:** Minor

```ts
await nudge(serverId, s.project, s.session, 'continue');
```

The nudge text is hardcoded as `'continue'`. This may be intentional (the supervisor skill sends "continue" to wake idle sessions), but if the supervisor skill expects a richer prompt or if this needs to be user-configurable, this will silently send the wrong thing. At minimum this should be a named constant.

---

## Files with No Bugs

- `src/services/roadmap-store.ts` `computeWaves` — cycle termination is correct (wave.length === 0 guard + break). Unknown-dep filtering is correct.
- `src/services/supervisor-store.ts` — DDL, `listEscalations`, `getSupervisorConfig`, `setSupervisorConfig` all correct.
- `ui/src/stores/uiStore.ts` — `supervisorViewOpen` state/actions correct.
- `ui/src/stores/supervisorStore.ts` — `loadConfig`, `saveConfig`, `nudge` actions correct.
- `ui/src/components/layout/Header.tsx` — badge logic correct.
- `ui/src/components/supervisor/SupervisorOnboarding.tsx` — no bugs.
- `ui/src/components/supervisor/SupervisorView.tsx` — no bugs.
- `ui/src/components/supervisor/RoadmapPanel.tsx` — no bugs (uses `roadmapToMermaid` but doesn't introduce new bugs itself).
- `ui/src/websocket/handler.ts` — type addition correct.
