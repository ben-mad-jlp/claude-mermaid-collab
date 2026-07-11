# Roadmap — Native App + Todos

Single index of both multi-phase efforts: status, branch/commit, design doc. Live status detail lives in `vibe.vibeinstructions`; completed blueprints are under `Archive/<slug>/`.

*Last updated: 2026-05-27. Neither feature branch is pushed.*

---

## Track 1 — Native Desktop App (Electron)
**Branch:** `feat/native-app-foundation` · **Plan:** `docs/plans/2026-05-26-native-app.md` · **Design:** \[\[design-native-app]]

| Phase | What                                                                                                                                                                                                                          | Status                             | Commit                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0–2   | Foundation — electron-vite shell, single-instance + deep links, **ServerSupervisor** (spawn/health/dedup), embedded **browser pane** (WebContentsView via CDP)                                                                | ✅ done                             | `68d261c`                                                                                                              |
| 3     | **Terminal pane** — xterm.js ↔ existing server-side Bun PTY (`/terminal/:id`)                                                                                                                                                 | ✅ done                             | `7d4f85a`                                                                                                              |
| 4–6   | **Remote connectivity** — server-config auth/binding, main-process HTTP+WS **proxy**, **server switcher** UI (\[\[design-remote-connectivity]], \[\[design-server-switcher]])                                                 | ✅ done                             | `08b267c`                                                                                                              |
| 7     | **Remote browser** — server-owned headless Chrome on its own machine (`MC_BROWSER_TARGET=owned-chrome`) (\[\[design-remote-browser]])                                                                                         | ✅ done                             | `cfcdc0e`                                                                                                              |
| 8     | **Packaging + signing** — electron-builder, `bun build --compile` sidecar + asset bundling, app icon, auto-update wiring; **signed + notarized + stapled build VERIFIED** (\[\[design-packaging]], \[\[macos-signing-guide]]) | ✅ **done + signed build verified** | `577a6ef`, icon `c00df73`, mac-signing-config `962ffbe`, build-unblock+verify-script `6d475e9`, WS-proxy-fix `764015f` |

**Phase 8 — signed build VERIFIED (2026-05-27).** Produced signed+notarized+stapled `Mermaid Collab-0.0.0-arm64.dmg`/`.zip` in `desktop/dist/` via an **App Store Connect API key** (Team Key, Developer role — account-wide, CI-ready). All 5 checks in `desktop/scripts/verify-signing.sh` pass: signature valid, Developer ID `N8N4CQ6RT3`, Gatekeeper "Notarized Developer ID", ticket stapled, `mc-server` sidecar signed.

- **Build-path fix (`6d475e9`):** `build:ui` now runs `vite build` directly (the root `tsc && vite build` gate fails on pre-existing unrelated type errors and blocked `npm run dist`).
- **WS proxy crash fix (`764015f`):** the main-process bundle inlines `ws`; Vite stubbed its optional native deps with frozen empty objects so ws's pure-JS fallback never engaged → `bufferUtil.unmask is not a function` on the first masked frame, killing all collab/terminal WS traffic. Fixed with a main-bundle banner forcing `WS_NO_BUFFER_UTIL=1`/`WS_NO_UTF_8_VALIDATE=1`. ⚠️ **The earlier signed** **`.dmg`/`.zip`** **predate this fix — re-run** **`npm run dist`** **for a working distributable.**
- **Still open on Phase 8:** real **auto-update feed** (electron-updater inert; signed builds now unblock it — `"publish": null` → GitHub Releases); **Windows signing**; **per-OS CI cross-builds**; bump version off `0.0.0` before publishing.

**Manual verifies pending:** live GUI launch (window loads sidecar UI; `browser_*` drives the pane); owned-chrome live launch; terminal typing.

### Debugging the desktop app (`d7f8a0f`)
Electron's renderer speaks CDP, so the app can be driven like a browser. Tooling on `feat/native-app-foundation`:

- **`desktop/scripts/debug-app.sh`** — fast launch loop: rebuilds main/preload/renderer, kills any running instance (matches the unique `--user-data-dir`, freeing the single-instance lock), then runs `electron .` on `out/` (**no electron-builder/signing step** → ~1–2s relaunch) with a fixed CDP port + Node inspector, teeing logs.
  - `./scripts/debug-app.sh` (rebuild + launch) · `--no-build` (relaunch only)
  - Env: `MC_CDP_PORT` (default **9223** — clear of Chrome's `9333`), `MC_INSPECT` (default **9229**, main-process inspector → `chrome://inspect`), `MC_LOG` (default `/tmp/mc-app.log`).
- **`desktop/scripts/app-debug.ts`** — CDP CLI (chrome-remote-interface), run `bun scripts/app-debug.ts <cmd>`:
  - `targets` — list page targets: `[main]` app UI vs `[pane]` embedded controlled browser (`mc-browser-pane`).
  - `shot [--target main|pane|<idx>] [--out f.png]` — screenshot → PNG.
  - `eval [--target …] '<js>'` — run JS in the renderer, returns the value.
  - `console [--target …] [--ms 3000]` — stream the target's console.
- **Opt-in main hooks (`index.ts`):** `MC_CDP_PORT` pins the renderer CDP port (else random); `MC_INSPECT` exposes the Node main process. Default launches are unchanged.

Gotchas baked in: cleanup matches `--user-data-dir` (plain pkill on the binary name missed the launcher and the lock bounced relaunches); port is off `9333` (the controlled Chrome already binds it → `bind() failed: Address already in use`).

---

## Track 2 — Todos Upgrade (per-project store → cross-session → Asana)
**Branch:** `feat/todos-upgrade-phase0` · **Designs:** \[\[design-todos-upgrade]] (P0 + ladder), \[\[design-todos-phase1-2]] (P1 & P2)

| Phase | What                                                                                                                                                                                                    | Status                 | Commit                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------- |
| 0     | **Per-project store** — bun:sqlite `todos.db`, upgraded model (UUID id, owner/assignee, status enum, priority/due/deps, asanaGid reserved), idempotent migration from per-session JSON, REST/MCP rewire | ✅ done                 | `73b72b1` (+ defensive fix `4013932`) |
| 1     | **Managing session** — cross-session assignment: enriched broadcast (owner/assignee), live-refetch gap fix + assign toast, assignee picker, manager dashboard (group-by-assignee)                       | ✅ done, reviewed       | `a28462b`                             |
| 2     | **Asana sync** — server-side `AsanaSyncEngine` (mirrors BindingSweeper), `ASANA_TOKEN`/gitignored config, outbox + Events-API poll + local-wins LWW, session→Asana section + custom fields. Push-first. | 📋 designed, NOT built | —                                     |

**Phase 2 — needs an Asana account + PAT to fully verify** (like mac signing — code/config buildable + unit-testable, live sync needs your token). Build order in \[\[design-todos-phase1-2]]: P2.1 engine skeleton → P2.2 push → P2.3 pull+reconcile → P2.4 setup UX.

**Manual verifies pending:** live two-session assignment (assign in A → B's UI refreshes + toast); legacy todo migration on a real project with existing `session-todos.json`.

**Tracked todo:** #1 — toast double-fire under rapid events (minor/cosmetic, accepted).

---

## Cross-cutting notes
- **Branches not pushed.** master untouched; `feat/native-app-foundation` (native app 0–8 + icon + signing config + verified signed build + WS-proxy fix + debug tooling); `feat/todos-upgrade-phase0` (todos P0 + P1).
- **Known infra bug:** the collab diagram-render endpoint is erroring server-side (`DOMPurify.addHook is not a function`) — diagrams couldn't be created in recent waves; non-blocking for code.
- **Rejected:** Slack for todos (cloud-only, no offline) — see \[\[design-todos-upgrade]] research; Asana chosen instead.

## Next options
1. **Re-run the signed** **`.dmg`** (post WS-fix) — `npm run dist && ./scripts/verify-signing.sh`.
2. **Auto-update feed** for the (now signed) native app — pick host, flip `"publish": null` → provider, bump version off `0.0.0`.
3. Blueprint + build **Todos Phase 2 (Asana)**.
4. **Push** a branch / open a PR.
5. Do a **manual verify** pass (native-app GUI launch; two-session todo assignment; todo migration).
