# Wave 2 Implementation

## Tasks

### ide-routes
- `src/routes/ide-routes.ts` — `POST /api/ide/create-terminal`:
  - Added `import { tmuxBaseName } from '../services/tmux-naming.js'`.
  - Now destructures `{ session, project }`, validates both (400 if missing).
  - Computes `tmuxSession = tmuxBaseName(project, session)` and spawns
    `tmux new-session -d -s <tmuxSession>` (was bare `session`).
  - Broadcasts `ide_open_terminal` with `{ session, project, tmuxSession }`.
  - Before/after diagram: `Implementing/Go/Wave 2/ide-routes/ide-routes.ts`.

### ide-state
- `src/services/ide-state.ts` — `ideConnected` reattach loop:
  - Added `import { tmuxBaseName } from './tmux-naming.js'`.
  - Added `tmuxSession: tmuxBaseName(project, session)` to the `ide_reattach` payload.

## Verification
- Per-file semantic review: both files match the blueprint + research plan.
- tsc stash-diff over both files: **no new error categories**. The only error touching
  these files is the pre-existing `TS5097` on `ide-routes.ts:3` (its existing `.ts`-extension
  import — unchanged). New imports use `.js` and are tsc-clean. `ide-state.ts` has zero errors.
- Both new union members from Wave 1 (`ide_open_terminal`, `tmuxSession` on `ide_reattach`)
  now type-match their broadcasts.

## Wave TSC
- No new errors. Baseline repo noise unchanged.
