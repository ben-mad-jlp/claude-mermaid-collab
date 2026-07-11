# Bug Review (todos Phase 0)

Scope: introduced correctness bugs only. Store/migration tests pass (13/13). tsc clean for in-scope files (the one api.ts:692 `pair_mode_changed` error is pre-existing and unrelated to todos).

## Findings

### 1. Minor — clearCompleted field-name contract mismatch
`src/routes/api.ts:2601` returns the raw store result `{ removed: number }`, but the UI client `clearCompletedSessionTodos` (`ui/src/lib/api.ts:717`) is typed to return `{ removedCount: number }`. The HTTP layer therefore delivers `removed`, so `removedCount` is always `undefined` on the client.

Note the inconsistency across layers: the MCP wrapper `clearCompletedSessionTodos` (`src/mcp/tools/session-todos.ts:296-297`) maps to `{ removedCount }`, while the HTTP route exposes `{ removed }`. Pick one shape.

Impact is low today because the only caller (`TodosTreeSection.handleClearCompleted`) ignores the return value, but the typed contract is wrong and will bite anyone who reads `.removedCount`.

Fix: in the route, return `{ removedCount: result.removed }` (matching the client type and the MCP wrapper), or change the client type/route to agree on `removed`.

### 2. Minor — `addSessionTodo` spread overrides the trimmed title with the untrimmed `extras.title`
`src/mcp/tools/session-todos.ts:228-235`. It computes `trimmed = (extras?.title ?? text).trim()`, sets `title: trimmed`, then does `...(extras ?? {})`. Because the spread comes after `title`, when `extras.title` is present it overwrites the trimmed value with the raw, untrimmed `extras.title`. `createTodo` does not trim, so the stored title keeps leading/trailing whitespace.

Currently masked: the MCP dispatch (`setup.ts:3730`) passes `extras` WITHOUT a `title` key, and the HTTP POST route calls `createTodo` directly (not this wrapper). So no live path hits it today, but the wrapper is incorrect for any caller passing `extras.title`. (`extras` also leaks a `title` field into `CreateTodoInput`, which is harmless but sloppy.)

Fix: spread first, then set `title` last, or omit `title` from the spread:
```ts
return createTodo(project, { ...(extras ?? {}), ownerSession: session, title: trimmed, link: link ?? null });
```

### 3. Minor — `reorderSessionTodos` return drops done todos
`src/mcp/tools/session-todos.ts:300-307` returns `listTodos(project, { session })`, which (with no `includeCompleted` and no `status`) applies the default `status != 'done'` exclusion. So the post-reorder list returned to an MCP caller silently omits completed todos. The HTTP `/reorder` route returns `{ ok: true }` and doesn't use this, so no live impact, but the MCP return value is incomplete.

Fix: pass `{ session, includeCompleted: true }`.

## Items checked, NOT bugs

- `withLock` error isolation (todo-store.ts:142-147): correct. A rejected queued op does not break the chain because `locks.set(project, next.catch(()=>{}))` stores a resolved promise for the next link, while the caller still receives the original rejecting `next`. Serialization holds.
- `updateTodo` status/completed/completedAt reconciliation (todo-store.ts:227-231): correct for normal cases. completedAt preserved when already done, cleared when leaving done. The only ambiguous case — passing BOTH `completed:false` AND `status:'done'` on an already-done todo resolves to `'todo'` — is conflicting caller input, not a real bug.
- `listTodos` WHERE/param building (todo-store.ts:183-197): param order matches clause order (session, owner, assignee, status); default-exclude-done only applies when neither `includeCompleted` nor an explicit `status` is set, which is correct. With the GET route defaulting `includeCompleted=true`, done todos are returned and filtered client-side in `visibleTodos`. Consistent.
- `createTodo` maxOrd on empty table (todo-store.ts:203-204): `MAX(ord)` returns null → `ord = 10`. Correct.
- `reorder` (todo-store.ts:280-289): does NOT validate that `ids` is a full permutation. Omitted ids keep their old `ord` (and can collide with the new `(i+1)*10` values); extra/unknown ids are no-ops. Per the blueprint this should validate a permutation, but the route only calls it with the client's full ordered list, and a partial/extra set merely produces a possibly-odd ordering — not data corruption. Flagging as a design gap, not a correctness bug.
- All store calls are Promises via `withLock`, and every caller awaits: api.ts routes (createTodo/updateTodo/clearCompleted/reorder/removeTodo all awaited), session-todos.ts wrappers (all awaited; `completeTodosForTask` awaits each update in the loop), setup.ts dispatch cases (all awaited). `getTodo`/`listTodos` are synchronous and correctly used without await.
- `setup.ts` `assign_session_todo` dispatch (3802-3813): correct args, validates project/session/id, broadcasts `session_todos_updated`. `id === undefined` guard intentionally allows empty-string ids through (store will 404), consistent with other cases.
- migration idempotency (todo-migration.ts:46): triple-guards on missing src / `.migrated` marker / sidecar; corrupt JSON is skipped (left in place); order preserved via sort by `order`; createTodo awaited in loop. Sound.
- UI `TodosTreeSection`: status cycle order + modulo wraparound correct; `me` sourced from `currentSession.name`; filters (showCompleted, statusFilter, assignedToMe) compose correctly; optimistic status patch reverts on error. `id.slice(0,6)` display fine for UUIDs. No bug.
- `removeSessionTodo` snapshots via `getTodo` before delete then returns it — fine. `toggleSessionTodo` reads current then updates; within a single project the lock serializes writes (the read is unlocked but acceptable for a toggle).

## Summary
3 minor bugs, all low live-impact (two are dormant on unused code paths, one is a typed-contract mismatch on an ignored return value). No Critical or Important issues. No data-integrity, concurrency, or SQL-correctness bugs found.
