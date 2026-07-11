# Deployment / Distribution Guide — mermaid-collab

Three distributable artifacts, all in one repo, at three very different maturity levels.

---

## TL;DR: to ship today you would…

- **Plugin (5.73.1)** — *ready & live.* Distributed via the git-backed Claude Code marketplace `mermaid-collab-dev`. To release: `npm version patch|minor|major` (auto-syncs plugin.json + marketplace.json + server.ts via the `version`/`version:sync` hooks, commits, tags) → `git push && git push --tags`. Users get it with `/plugin marketplace add` + `/plugin install`, and update by re-pulling the marketplace (the cache tracks `gitCommitSha`). **This is the only fully-shippable path right now.**
- **Desktop app** — *buildable & macOS-signable, but NOT yet releasable.* `cd desktop && npm run dist` produces a **signed + notarized + stapled** `.dmg`/`.zip` on this machine (Developer ID `Benjamin Maderazo (N8N4CQ6RT3)`, App Store Connect API key). Blockers before public release: `version` is still `0.0.0`, `"publish": null` (no auto-update feed), no Windows signing, and no CI for per-OS cross-builds.
- **VSCodium extension (1.1.0)** — *built locally, distributed via the server, not the marketplace.* `cd extensions/vscode && npm run package` builds `out/extension.js` (esbuild) + a `.vsix`. The in-editor `mermaid-collab: Update Extension` command fetches `/api/extension/js` from the server and overwrites itself live. **Critical bug:** that endpoint serves a **hardcoded absolute path** (`/srv/codebase/...`) that exists only on the author's deploy box — see "Server" section.
- **Server** — no standalone deploy story; it is started *by* the plugin hook (`bun run src/server.ts`) and *embedded* in the desktop app as a `bun build --compile` sidecar (`mc-server`).

---

## 1. Desktop app (Electron) — `desktop/`

### Build
- Config: `desktop/package.json:30-59` (electron-builder `build` block).
- One command does everything: `cd desktop && npm run dist`
  - `package.json:13` → `build:ui` (`cd ../ui && bunx vite build`) → `build` (`electron-vite build`) → `build:sidecar` → `electron-builder`.
  - `build:ui` deliberately calls `vite build` directly (not the root `tsc && vite build`) to skip a whole-project type-check that fails on unrelated pre-existing errors (per `macos-signing-guide.md:8`).
- `dist:dir` (`package.json:14`) makes an unpacked `--dir` build (no installers) for local testing.

### Sidecar (`desktop/scripts/build-sidecar.ts`)
- Compiles `src/server.ts` → a self-contained `desktop/resources/mc-server` (`.exe` on Windows) via `bun build --compile` (`build-sidecar.ts:16-19`). Builds **host target only**; cross-OS needs per-OS CI (`build-sidecar.ts:6-7`).
- Bundled as `extraResources` (`package.json:34-38`: `ui/dist`, `public`, `resources/mc-server` → `mc-server`).
- At runtime the Electron main spawns it from `process.resourcesPath/mc-server` (`desktop/src/main/index.ts:161`) with `MERMAID_RESOURCES_PATH` so it finds the bundled UI (`desktop/src/main/server-supervisor.ts:102`).

### Targets (`package.json:39-57`)
- **mac**: `dmg` + `zip`, `hardenedRuntime: true`, `gatekeeperAssess: false`, entitlements `build/entitlements.mac.plist`, **`notarize: true`**, icon `build/icon.png`.
- **win**: `nsis` (no signing configured).
- **linux**: `AppImage` + `deb`.

### macOS signing/notarization — DONE (verified)
Full procedure: `.collab/sessions/local/documents/macos-signing-guide.md`.
- Developer ID Application cert `Benjamin Maderazo (N8N4CQ6RT3)` installed in login keychain; electron-builder auto-discovers it. Use `APPLE_TEAM_ID=N8N4CQ6RT3` (NOT the personal `3FYX7956PV`).
- Notarization via **App Store Connect API key** (team-wide, CI-friendly): export `APPLE_API_KEY` (path to `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (guide §4). Do not leave a stray `APPLE_ID` set or electron-builder falls back to the app-specific-password path and errors.
- Entitlements (`build/entitlements.mac.plist`): `allow-jit`, `allow-unsigned-executable-memory`, **`disable-library-validation`** (so the hardened app can spawn the `mc-server` sidecar + Chrome), `allow-dyld-environment-variables`.
- **Verify**: `cd desktop && ./scripts/verify-signing.sh` — checks deep/strict codesign, Developer ID authority + `TeamIdentifier=N8N4CQ6RT3`, Gatekeeper "Notarized Developer ID", stapled ticket, and that the **`mc-server` sidecar** is signed (`verify-signing.sh`).
- Gotcha: `errSecInternalComponent` during codesign = non-interactive shell can't reach the keychain key; either run in a GUI Terminal (click "Always Allow") or `security set-key-partition-list …` once (guide §Troubleshooting).

### MISSING / BLOCKED for real distribution
1. **Version is `0.0.0`** (`desktop/package.json:4`) — must bump before any release; desktop is not wired into the root `npm version` sync.
2. **No auto-update feed.** `electron-updater` is wired (`desktop/src/main/index.ts:206-210`, packaged-only `autoUpdater.checkForUpdatesAndNotify()`) but `"publish": null` (`package.json:58`) makes it inert. To enable (guide §Auto-update): set `"publish": { "provider": "github", "owner": …, "repo": … }`, then `npm run dist -- --publish always` with a `GH_TOKEN`.
3. **Windows signing** — none. Needs a code-signing cert → `CSC_LINK`/`CSC_KEY_PASSWORD` (or Azure Trusted Signing). No notarization on Windows, but signing builds SmartScreen reputation (guide §Windows).
4. **No CI / per-OS cross-builds.** You cannot notarize macOS from Linux; need a `macos/windows/ubuntu` runner matrix each running `npm run dist` with platform secrets (guide §CI note). **There is no `.github/` in the repo at all.**

---

## 2. Claude Code plugin — `.claude-plugin/` + `hooks/` + `src/`

### What it is
- `.claude-plugin/plugin.json` (v5.73.1) declares the hook wiring (SessionStart, UserPromptSubmit, Pre/PostToolUse, Permission*, Stop → scripts under `${CLAUDE_PLUGIN_ROOT}/scripts/`).
- `.claude-plugin/marketplace.json` (v5.73.1) is the dev marketplace `mermaid-collab-dev` with `source: "./"` (the repo itself is the plugin).

### How users install / update
- Distribution is the **git-backed marketplace** mechanism. A user adds the marketplace (e.g. `/plugin marketplace add ben-mad-jlp/claude-mermaid-collab`) and installs `mermaid-collab`.
- Installed plugins live in the cache: `~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/<version>/` and are tracked in `~/.claude/plugins/installed_plugins.json` by **`version` + `gitCommitSha`** (verified: `mermaid-collab@mermaid-collab-dev` → `5.73.1`, commit `4228cf2…`).
- **Updates reach users by git tag/commit**: bump the version + push; users re-pull the marketplace and Claude Code re-syncs the cache to the new `gitCommitSha`.

### Server auto-start
- `hooks/server-check.sh` is a PreToolUse hook for `mcp__mermaid__*` tools: curls `http://localhost:9002/api/health`; if down, runs `cd "$PROJECT_ROOT" && bun run src/server.ts` in the background and polls up to 10s (`server-check.sh:18-45`). So the plugin = the server's launcher. **Requires `bun` on the user's PATH.**

### Version release flow (the canonical path — CLAUDE.md)
- `npm version patch|minor|major` triggers the `version` script (`package.json:23`) → `version:sync` (`package.json:22`) which rewrites `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the `SERVER_VERSION` const in `src/mcp/server.ts`, then `git add`s them. npm then commits + tags.
- Then `git push && git push --tags`.
- **Never hand-edit version numbers.**

### Redistributing 5.73.1 concretely
The tag `v5.73.1` already exists and plugin.json/marketplace.json are already at 5.73.1, so 5.73.1 is published. To cut the *next* release: `npm version patch` → `git push && git push --tags`. Done — no build artifact to upload; the repo *is* the artifact.

---

## 3. VSCodium / VS Code extension — `extensions/vscode/`

### What it is now (diff-only)
- `extension.ts:1-7`: stripped to a single job — when the collab server broadcasts `ide_open_diff`, open that file's working-tree diff. Declared `extensionKind: ["workspace"]` (`package.json:16`) so it runs on the host with the files + git (local or SSH-remote end). Two commands: `mermaidCollab.reconnect`, `mermaidCollab.update` (`package.json:21-30`).

### Build (esbuild + vsce)
- `package.json:53` `compile`: `esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --platform=node --target=node18`.
- `package.json:54` `package`: `npm run compile && vsce package` → a `.vsix` (history of `mermaid-collab-vscode-1.0.0 … 1.0.22.vsix` are checked into the dir; current `package.json` version is `1.1.0`).

### Distribution — two channels
1. **`.vsix`** — built by `npm run package`, install manually via "Install from VSIX". Not published to any Marketplace/Open VSX (publisher `mermaid-collab` is set but no publish step exists).
2. **Server-served live update (primary)** — `mermaidCollab: Update Extension` (`extension.ts:26-42`) fetches `${httpBase}/api/extension/js`, overwrites its own `out/extension.js` in place (`writeFileSync(__filename, …)`), and offers a reload. So the **server ships the extension bundle**; you "redistribute" by just rebuilding `out/extension.js` on the server box and having clients run the Update command.

### BLOCKER (deployment bug)
- The server endpoint hardcodes an absolute path: `src/server.ts:303` →
  `const extJsPath = '/srv/codebase/claude-mermaid-collab/extensions/vscode/out/extension.js';`
  This only exists on one specific deploy host. On any other machine (and inside the desktop sidecar) `/api/extension/js` returns 404, so the in-editor auto-update silently fails. **Fix needed:** resolve the path relative to the server root / `MERMAID_RESOURCES_PATH` (or the repo) instead of `/srv/codebase/...` before the update channel is portable.

---

## 4. The server — `src/server.ts`

No standalone deploy/packaging story of its own; it is consumed two ways:
- **Plugin**: launched on demand by `hooks/server-check.sh` (`bun run src/server.ts`, port 9002). Requires `bun` installed.
- **Desktop**: compiled to the `mc-server` sidecar (`bun build --compile`) and bundled in the `.app`/installer; spawned by the Electron main with `MERMAID_RESOURCES_PATH` (no `bun` needed on the user's machine — the binary is self-contained).
- Dev: `bun run dev` (concurrent api + ui), `bun start` (build UI then serve). Health: `GET /api/health`. Serves the React UI from `ui/dist` and the extension bundle from `/api/extension/js`.

---

## Recommended release checklist

### Plugin (ready)
- [ ] `npm version patch|minor|major`
- [ ] confirm plugin.json / marketplace.json / `src/mcp/server.ts` SERVER_VERSION all bumped (the hook does this)
- [ ] `git push && git push --tags`
- [ ] verify a fresh `/plugin marketplace add` + install picks up the new `gitCommitSha`

### Desktop (needs work first)
- [ ] set a real `version` in `desktop/package.json` (and wire it into release automation)
- [ ] in a GUI Terminal: export `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`, `unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD`
- [ ] `cd desktop && npm run dist`
- [ ] `./scripts/verify-signing.sh` → all green
- [ ] (for auto-update) set `"publish": { provider: github, … }`, `npm run dist -- --publish always` with `GH_TOKEN`
- [ ] (Windows) add a signing cert + `CSC_LINK`/`CSC_KEY_PASSWORD`
- [ ] add `.github/workflows` matrix (macos/windows/ubuntu) — currently absent

### VS Code extension
- [ ] **Fix the hardcoded `/srv/codebase/...` path in `src/server.ts:303` first** (blocks portable auto-update)
- [ ] `cd extensions/vscode && npm run package` (esbuild + vsce → `.vsix`)
- [ ] ship `out/extension.js` to the server box so `/api/extension/js` serves the new bundle
- [ ] users run `mermaid-collab: Update Extension` → Reload

## State summary

| Artifact | Build cmd | Signed/Notarized | Auto-update | Released today? |
|---|---|---|---|---|
| Plugin | `npm version …` + push | n/a (git) | git re-pull (cache `gitCommitSha`) | **Yes (5.73.1)** |
| Desktop | `cd desktop && npm run dist` | macOS yes; Win no | wired but `publish:null` (inert) | No (v0.0.0, no feed) |
| VS Code ext | `npm run package` | n/a | server-served, **broken path** | Partial (vsix only) |
| Server | (no standalone) | via sidecar signing | n/a | via plugin/desktop |
