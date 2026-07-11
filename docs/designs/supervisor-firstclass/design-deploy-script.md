# Deploy script + sidecar lifecycle fix (review E1)

The deploy is a manual, multi-step, footgun-laden ritual. We hit every footgun live this session. Automate it into one safe command, and fix the root-cause lifecycle bug behind the worst one.

## What actually goes wrong (observed this session)

Deploying = build `ui/dist` + compile `mc-server`, back up + swap both into `/Applications/Mermaid Collab.app/Contents/Resources/`, restart, verify. Three failure modes we hit:

1. **The sidecar survives `quit app`.** `mc-server` is detached from the Electron lifecycle, so quitting the app leaves the old server running on port 9002. The relaunched app just **reconnects to the stale server** — the new binary never runs. We only fixed it by manually `kill`-ing the old PID, *then* relaunching. **This is the root-cause bug.**
2. **Deploy builds from the working tree.** The live binary can be **ahead of committed history** (the merge near-miss: committed HEAD didn't build while the deployed working tree did).
3. **Manual + no verification gate.** Many steps by hand; nothing confirms the *new* PID is actually serving before you walk away.

## Fix — two parts

### Part 1 (root cause): make the sidecar die with the app
In the Electron main (`desktop/src/main/server-supervisor.ts`), spawn `mc-server` as a **managed child** that is killed on app `quit`/`before-quit` (and on `window-all-closed`). Then a normal **quit → relaunch actually redeploys** — no orphaned server, no manual kill. This removes footgun #1 at the source and shrinks the script.

### Part 2: a one-command deploy script (`scripts/deploy.ts`, `bun run deploy`)
Deterministic, idempotent, verified:
1. **Cleanliness gate** — refuse to deploy from a dirty tree unless `--from-working-tree` is passed (default: require a clean commit; addresses footgun #2 + review open-question G). Print the commit SHA being deployed.
2. **Build** — `ui` bundle + `mc-server` sidecar; abort on any build failure (don't touch the app bundle if the build is red).
3. **Backup** — timestamped `.bak` of the current `mc-server` + `ui/dist` in the app Resources; prune to the last N.
4. **Stop** — kill the running sidecar (`pkill -f Resources/mc-server`), **wait until the port is free** (poll), so the new one binds it. (Belt-and-suspenders even after Part 1.)
5. **Swap** — copy new `mc-server` + `ui/dist` into the bundle.
6. **Relaunch** — `open -a "Mermaid Collab"`.
7. **Health-check** — poll until a sidecar with a **new PID** answers `:9002` healthy; **fail loudly** (and offer rollback from the `.bak`) if it doesn't come up within a timeout.
8. **Report** — old PID → new PID, commit SHA, what was swapped.

### Rollback
`bun run deploy --rollback` restores the most recent `.bak` mc-server + ui/dist and restarts — the escape hatch if a deploy serves a broken build.

## Acceptance (releasable todo)

- `bun run deploy` from a **clean** tree: builds, backs up, stops the old sidecar, swaps, relaunches, and **confirms a new-PID healthy server** — with zero manual steps; refuses (clear message) if the tree is dirty unless `--from-working-tree`.
- After Part 1, a plain **quit→relaunch** of the app starts a **fresh** sidecar (no orphan on 9002) — verified by PID change.
- `--rollback` restores the previous artifacts and the app comes back healthy.
- Build failure aborts **before** the bundle is touched (no half-swapped state).

NOTE: this is desktop/operational tooling (`desktop/`, `scripts/`); no per-project data involved. Independent of worktree isolation. Mostly a hands-off task EXCEPT the health-check/relaunch steps need the packaged app to verify — flag for whoever has the desktop env.
