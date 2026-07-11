# Building the Windows Desktop App

How to build the Windows (NSIS) installer locally — e.g. inside a Parallels /
VMware Windows VM. This mirrors `.github/workflows/build-windows.yml`, which
builds the same thing on a native `windows-latest` runner on `v*` tags.

Committed to repo at `desktop/BUILD-WINDOWS.md` (commit 188ea2a).

> The installer is **unsigned** (no Windows code-signing cert), so SmartScreen
> warns on first run — click **More info → Run anyway**.

## 1. One-time prerequisites (in Windows)

Open **PowerShell** and install the toolchain:

```powershell
# Bun
irm bun.sh/install.ps1 | iex

# Node 20 (LTS) + Git
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Reopen PowerShell so the new PATHs load, then verify:

```powershell
bun --version
node --version    # should be 20.x
git --version
```

## 2. Clone the repo *inside Windows*

> ⚠️ Do **not** build from a shared folder (`\\Mac\...`, `Z:\`, `/Volumes/...`).
> `bun build --compile` and electron-builder need a native NTFS path or they
> produce a broken exe / fail on symlink + junction handling. Clone fresh into
> the Windows filesystem.

```powershell
cd $HOME
git clone https://github.com/ben-mad-jlp/claude-mermaid-collab.git
cd claude-mermaid-collab
```

## 3. Build (mirrors the CI workflow)

Run from the repo root, top to bottom:

```powershell
# root deps (needed to compile the Bun sidecar)
bun install

# build the React UI
cd ui
bun install
bunx vite build
cd ..

# desktop: deps + electron-vite build (main / preload / renderer)
cd desktop
npm install
npm run build

# compile the Bun server into resources\mc-server.exe
bun run scripts/build-sidecar.ts
```

Confirm the sidecar exe exists:

```powershell
dir resources\mc-server.exe
```

## 4. Package or run

**Fast loop (recommended while debugging)** — unpacked app, no installer:

```powershell
$env:CSC_IDENTITY_AUTODISCOVERY = "false"
npm run dist:dir
.\dist\win-unpacked\"Mermaid Collab.exe"
```

**Full installer:**

```powershell
$env:CSC_IDENTITY_AUTODISCOVERY = "false"
bunx electron-builder --win --publish never
```

The installer lands in `desktop\dist\*.exe`.

## 5. Diagnosing a failed startup

The desktop shell shows a branded **loading screen** while the bundled sidecar
(`mc-server.exe`) starts, then swaps to the real collab UI. If the sidecar never
becomes healthy, the loading screen flips to an **error panel** (message +
stderr tail + log path + Retry) instead of hanging.

Full sidecar output is teed to:

```powershell
notepad "$env:APPDATA\Mermaid Collab\logs\sidecar.log"
```

When reporting a startup failure, include:
- whatever the error screen shows,
- the contents of `sidecar.log`,
- and, if `bun run scripts/build-sidecar.ts` itself errored, that output too (a
  sidecar that won't even compile on Windows would itself be the root cause).

## Gotchas

- `npm install` in `desktop/` downloads Electron binaries — the first run is
  slow; let it finish.
- The `electron-agent-bridge` git dependency is a public repo that ships built
  `dist/`, so it resolves without extra build steps on Windows.
- `app.isPackaged` is **false** under `npx electron .`, so that path runs the
  sidecar via `bun run src/server.ts` instead of `mc-server.exe`. To exercise
  the real compiled-binary path, use a packaged build (`dist:dir` / installer).
