# Wave 1 Implementation

## Tasks

### tmux-naming
- **NEW** `src/services/tmux-naming.ts` — exported pure `tmuxBaseName(project, session)`:
  `mc-${slug(basename)}-${slug(session)}`, slug = lowercase alphanumeric, ≤24 chars, fallback `x`.
- **NEW** `src/services/__tests__/tmux-naming.test.ts` — 8 vitest cases (happy path, symbol stripping,
  trailing slash, 24-char truncation, all-symbols→`x` fallback ×2, cross-project distinctness,
  documented same-basename collision).

### ws-handler-types
- `src/websocket/handler.ts` — WSMessage union: added `tmuxSession: string` to `ide_reattach`;
  added new `ide_open_terminal` member (`session`, `project`, `tmuxSession`) after `ide_open_diff`.

## Verification
- `tmux-naming.test.ts` — **8/8 pass** (`vitest run`).
- Per-file semantic review: all three files match the blueprint.
- `handler.ts` proven clean via stash-diff: the only tsc deltas were identical pre-existing
  `browser_*` no-overlap errors shifted +1 line by the added union member. Zero new errors.

## Wave TSC
- No new errors introduced. Bare `npx tsc --noEmit` reports ~70 PRE-EXISTING baseline errors
  (mostly `TS5097` `.ts`-extension imports in `src/agent/__tests__/*`) — this is a Bun project
  and bare tsc is not its real typecheck gate. None touch the wave's files.
