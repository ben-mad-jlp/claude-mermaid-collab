# Blueprint — [UI] Kanban card description overflows on long filepath / unbroken word

## Problem
In the Plan Kanban swimlanes, a todo card has a FIXED width (`w-56`) but the text
content inside it has no overflow-wrap handling. A long unbroken token — e.g. a
120-char filepath with no spaces — does not soft-wrap, so it renders wider than
the card's content box and visually overflows the card / column.

## Where the text renders
`ui/src/components/supervisor/PlanKanban.tsx`, in the `PlanCard` component.

The card is a fixed-width button:
- Line 100: `className={`w-56 shrink-0 text-left rounded-md border px-3 py-2.5 space-y-1.5 ...`}`

The free-text div (the "description" referenced by the task — the codebase renders
the todo's `title` string here; there is no separate description field on the card,
so this title text IS the overflowing content):
- **Line 102:** `<div className="text-xs leading-tight text-gray-800 dark:text-gray-100">{todo.title}</div>`

This div has NO `break-words` / `overflow-wrap`, so a long unbroken word escapes the
`w-56` box. (The secondary `assigneeSession` span on line 116 already uses `truncate
max-w-[10rem]`, so it is NOT the bug.)

## Exact change
Add overflow-wrap handling to the text div on line 102. Tailwind `break-words`
maps to `overflow-wrap: break-word` (breaks long words at arbitrary points when they
would overflow). Because a 120-char filepath can be a single token with NO break
opportunities, also add `break-all` is NOT desired (it breaks normal words ugly);
prefer `break-words` which Tailwind backs with `overflow-wrap: break-word`. For a
truly unbroken 120-char token, `overflow-wrap: break-word` is the correct CSS and
will wrap it within the box.

Change line 102 from:
```tsx
<div className="text-xs leading-tight text-gray-800 dark:text-gray-100">{todo.title}</div>
```
to:
```tsx
<div className="text-xs leading-tight text-gray-800 dark:text-gray-100 break-words">{todo.title}</div>
```

Notes:
- The parent button is `flex`-less block content (`space-y-1.5`), and the div is a
  normal block child of a fixed-width (`w-56`) button, so `break-words` constrains
  to the card content box (`w-56` minus `px-3`). No `min-w-0` needed because the div
  is block, not a flex item.
- Do NOT use `truncate`/line-clamp here: the acceptance criterion is "long paths
  wrap … within the card bounds", and a wrapped path is more useful than an
  ellipsized one for a plan card. `break-words` satisfies the acceptance line
  ("a 120-char path stays within its column width").

## Test (vitest)
Add a case to the existing suite `ui/src/components/supervisor/PlanKanban.test.tsx`
(uses vitest + @testing-library/react; `todo({...})` factory at top; cards carry
`data-testid="plan-card"`). Assert the text div for a long-path title carries the
`break-words` class:

```tsx
it('wraps a long unbroken filepath in the card (no overflow)', () => {
  const longPath = '/' + 'a'.repeat(120);
  render(<PlanKanban todos={[todo({ id: 'A', title: longPath })]} showCompleted />);
  const text = screen.getByText(longPath);
  expect(text.className).toContain('break-words');
});
```
(If `getByText` is brittle on the long string, instead query the card via
`screen.getByTestId('plan-card')` and assert its first text div `.className`
contains `break-words`.)

## Build / verify
`ui/` is Bun-managed — NEVER run `npm install` (corrupts node_modules → spurious JSX
type errors). Run the focused test from repo root:
```bash
npm run test:ci -- ui/src/components/supervisor/PlanKanban.test.tsx
```
(Backend `test:ci` runner per CLAUDE.md; the UI vitest path is invoked the same way.
If the UI suite uses Bun's vitest, run `bun run test` filtered to the file instead —
do not `npm install`.) A quick visual check in the running app is also acceptable
per the acceptance note.

## Scope guard
Single-line className edit on line 102 of one component + one vitest case. No prop,
type, or data-flow changes. `assigneeSession` already truncates; leave it.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["ui/src/components/supervisor/PlanKanban.tsx", "ui/src/components/supervisor/PlanKanban.test.tsx"],
  "tasks": [
    { "id": "add-break-words", "files": ["ui/src/components/supervisor/PlanKanban.tsx"], "description": "Add `break-words` to the card text div (line 102) so long unbroken filepaths wrap within the w-56 card." },
    { "id": "add-wrap-test", "files": ["ui/src/components/supervisor/PlanKanban.test.tsx"], "description": "Add a vitest case asserting a 120-char path title renders with the break-words class on the card text div." }
  ] }
```
