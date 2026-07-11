# Wave 3 — todos↔blueprint linking

## Tasks
- **ui-todo-rows** (`SessionTodosSection.tsx`, `sidebar-tree/TodosTreeSection.tsx`, + test): both TodoRow variants render a clickable muted chip `↳ {shortSlug(blueprintId)}{ · taskId}` when `todo.link` is set (kept the `#{id}` prefix). Chip click → `selectDocument(blueprintId)` (store action, confirmed at sessionStore:349). `shortSlug` strips a leading `Implementing/` or `Archive/<slug>/`. Test: +3 chip tests (renders with link / absent without link / click calls selectDocument).
- **skill-vibe-go** (`skills/vibe-go/SKILL.md`): Step 4.7 now calls `complete_linked_todos { blueprintId, taskId }` for each completed task.
- **skill-vibe-review** (`skills/vibe-review/SKILL.md`): Case B "Add as todo" passes `link.blueprintId`; new sub-step 4.8 files deferred completeness gaps as linked todos (shelved-only).

## Verification
- ui tsc clean for all changed UI files; `selectDocument` confirmed on store.
- `SessionTodosSection.test.tsx`: **13 tests pass** (10 + 3 new).

## Wave TSC
Clean for changed files. (Pre-existing unrelated error `api.ts:692 pair_mode_changed` confirmed present on HEAD — not from this work.)
