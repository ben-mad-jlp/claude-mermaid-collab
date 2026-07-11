# Design: Packaging, Signing & Auto-Update (Phase 8)

Final design doc in the native-app series — see [[design-native-app]] (Q2 electron-builder, Q3 minimal auto-update, Q1 sidecar packaging notes).

## Goal
Produce installable, (eventually) signed apps for macOS/Ubuntu/Windows that bundle the Bun server as a compiled sidecar + its asset dirs, with minimal auto-update.

## The make-or-break unknown (spike this FIRST)
`bun build --compile` bundles JS/TS into one executable and **carries bun:sqlite + the Bun-native PTY** (no native node addons at runtime — confirmed). But it does **NOT** bundle asset dirs (`ui/dist`, `public/`). So:

> **Spike to validate before any packaging config:** compile `src/server.ts` to a single binary, run it with the asset dirs resolved externally, and confirm it serves `/api/health` + the real UI. If that works, the whole approach is sound; if not, packaging needs a different server strategy.

## Decisions

### D1 — Ship the server as a per-OS compiled sidecar + external assets
- `bun build --compile --target=bun-<os>-<arch> src/server.ts --outfile <out>` per platform (darwin-arm64/x64, linux-x64, win-x64).
- `ui/dist` + `public/` ship as electron-builder **`extraResources`** (NOT inside asar, NOT inside the binary).
- **Path resolution (the key code change):** `src/config.ts` `PROJECT_ROOT` must honor an env override:
  `PROJECT_ROOT = process.env.MERMAID_RESOURCES_PATH ?? <today's import.meta.dir-based value>`.
  Then `UI_DIST_DIR`/`PUBLIC_DIR` resolve under the bundled resources in prod, unchanged in dev.

### D2 — Dev vs prod sidecar launch (ServerSupervisor)
- **Dev** (`!app.isPackaged`): today's path — `bun run src/server.ts`, cwd=repo (`MC_REPO_ROOT`).
- **Prod** (`app.isPackaged`): spawn the compiled binary at `process.resourcesPath/server-<target>`, with env `MERMAID_RESOURCES_PATH=process.resourcesPath` so it finds `ui/dist`/`public`. Add a `serverBinaryPath?`/`mode` option to `ServerSupervisor` (it already abstracts spawn).

### D3 — electron-builder (+ electron-vite) — unanimous from [[design-native-app]]
- Config in `desktop/package.json` `build` key (or `electron-builder.yml`): `appId` (e.g. `com.mermaid-collab.desktop`), `productName`, `files: [out/**]`, `extraResources` mapping `../../ui/dist`→`ui/dist`, `../../public`→`public`, and the per-arch server binary→`server-<target>`.
- Targets: mac `dmg` (+ `zip` for updater), win `nsis`, linux `AppImage` + `deb`.
- The server binary is a separate Mach-O/PE/ELF → must be **signed independently** (mac hardened runtime; win cert) or Gatekeeper/SmartScreen blocks it.

### D4 — Auto-update: minimal, v1, credential-gated
- `electron-updater` against **GitHub Releases**; `autoUpdater.checkForUpdatesAndNotify()` in main.
- macOS auto-update **requires** notarization+signing; Linux auto-update = **AppImage** only (deb/rpm defer to system pkg mgr).
- **Must-test (when credentials exist):** an update swaps the unpacked server binary AND re-validates its signature.

### D5 — Version sync
- Root `package.json` version is source of truth (already synced to plugin/marketplace/server.ts via the `version:sync` hook). Extend the hook to also write `desktop/package.json` version.

## What needs YOUR credentials / CI (cannot be verified here)
- **macOS:** Apple Developer ID cert + app-specific password for notarization; entitlements (incl. the sidecar binary).
- **Windows:** code-signing cert (or Azure Trusted Signing).
- **Auto-update:** a GitHub repo/release feed + the signing above.
- **CI:** per-OS runners to cross-build the three platforms (Bun cross-compile is usable; signing must run on the target-appropriate runner).
- **Icons:** `icon.icns`/`icon.ico`/PNG — none exist in `desktop/` yet.

## What I can build + verify now (no credentials)
1. **Spike:** `bun build --compile` the server, run it with external assets, confirm it serves health + UI. ← de-risks everything.
2. `config.ts` `MERMAID_RESOURCES_PATH` override.
3. `ServerSupervisor` dev/prod split + `index.ts` `app.isPackaged` wiring.
4. A `desktop/scripts/build-sidecar.ts` that compiles the server for the host platform into `desktop/resources/`.
5. electron-builder config (targets, extraResources) + dep.
6. A local **unsigned** `electron-builder --dir` build (or `--mac` without signing) to validate packaging plumbing end-to-end; launch it and confirm the bundled sidecar serves the UI.
7. Auto-update wiring (`electron-updater`) behind config, inert without a publish feed.

## Risks
- Bun cross-compilation from one host (mac) for win/linux — may need per-OS CI; the host-platform build is verifiable now.
- `import.meta.dir` semantics inside a compiled binary — the `MERMAID_RESOURCES_PATH` override sidesteps reliance on it.
- Binary size: 3× per-arch server binaries (~50–90MB each) inflate installers.
- Signing the sidecar separately is the migration-specific gotcha (flagged in [[design-native-app]]).

## Build order
1. Spike (compile + serve). 2. config path override. 3. supervisor dev/prod + index wiring. 4. build-sidecar script. 5. electron-builder config. 6. local unsigned build + launch verify. 7. auto-update wiring (inert). 8. (later, with creds) signing/notarization/CI.
