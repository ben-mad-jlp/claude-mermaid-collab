# Blueprint: P2 node prompts must pin the PROJECT tsconfig for tsc, never a bare file

## Problem

Pilot finding (2026-06-16): the floor-path node prompts cause the implement/review
node to run `npx tsc --noEmit` against a bare file (e.g. the one new file), which
yields false failures like `TS2339 'includes' on readonly string[]` because tsc
has no project `lib`/`compilerOptions` context. The generated code was correct
under the repo `tsconfig.json`. This is a brittle-prompt bug, not an executor bug.

## Key finding — only the FLOOR path is affected

The WAVES path is already correct. `buildWavePrompt` (`src/services/leaf-executor.ts:282`)
verify case at **lines 320–327** already instructs:

```
'From the repo root, run EXACTLY: `npx tsc --noEmit -p tsconfig.json`',
'(the PROJECT config — never a standalone/temp tsconfig, so cross-file types resolve).',
```

This is the R3 fix and is the exact pattern to mirror. **Do not touch the waves
prompts** — they are the reference.

The FLOOR path is `buildNodePrompt` (`src/services/leaf-executor.ts:202`). Its
`implement` (lines 238–249) and `review` (lines 250–260) cases reference compiling
("Make REAL, compiling code edits", "it compiles") but give **no instruction on
HOW** to run tsc. With no guidance, the node defaults to `npx tsc --noEmit <file>`
on a bare path → the false TS2339. There is a repo-root `tsconfig.json` (confirmed
present) and the project gate is `npx tsc --noEmit` (`.collab/project.json`).

## Change — single file, `src/services/leaf-executor.ts`

Add an explicit tsc-discipline line to the two floor-path cases in `buildNodePrompt`,
mirroring the waves R3 language. Do not add a *required* tsc run to `implement`
(the executor drives the gate; implement is Read/Edit only and "Do NOT run the
acceptance gate"). Instead, scope the guidance to "**if** you check compilation".
For `review` (which is allowed Bash for inspection and judges "it compiles"), make
the project-config instruction explicit.

### Edit 1 — `implement` case (around line 247–248)

The current trailing line is:

```
'Do not stub or leave TODOs. Do NOT run the acceptance gate or report completion —',
'the executor drives the gate. Just make the edits the blueprint specifies.',
```

Append one line so any optional compile check uses the project config:

```
'the executor drives the gate. Just make the edits the blueprint specifies.',
'If you spot-check compilation, run tsc ONLY from the repo root via `npx tsc --noEmit -p tsconfig.json` (the PROJECT config) — NEVER `tsc <file>` on a bare path, which drops the project lib/options and yields false errors.',
```

### Edit 2 — `review` case (around line 256)

The current line is:

```
'Decide if the work is complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
```

Insert a tsc-discipline line immediately after it (before the VERDICT lines):

```
'Decide if the work is complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
'To check compilation, run tsc ONLY from the repo root via `npx tsc --noEmit -p tsconfig.json` (the PROJECT config) — NEVER `tsc <file>` on a bare path; a bare-file run drops the project lib/options and produces false errors (e.g. TS2339 on readonly arrays). Code that fails ONLY under a bare-file run is NOT a real failure.',
```

## Notes / constraints

- Keep the array-of-strings `.join('\n')` (and `.filter(Boolean)` for implement) shape intact.
- Use straight backticks/quotes consistent with surrounding lines; this is a TS string literal — escape nothing beyond what the existing lines do (template/normal strings already used).
- No behavioral/runtime change; this is prompt text only. No new functions, no signature changes.

## Verification

- `npx tsc --noEmit -p tsconfig.json` from repo root: clean.
- Grep `buildNodePrompt` review/implement cases now contain `-p tsconfig.json`.
- Existing gate-runner / gate-status tests unaffected (they assert on `gateCommand`, not node prompts).

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [], "filesToEdit": ["src/services/leaf-executor.ts"],
  "tasks": [ { "id": "pin-project-tsconfig-in-floor-prompts", "files": ["src/services/leaf-executor.ts"], "description": "Add project-tsconfig tsc-discipline lines to buildNodePrompt implement+review cases, mirroring the waves R3 verify prompt." } ] }
```
