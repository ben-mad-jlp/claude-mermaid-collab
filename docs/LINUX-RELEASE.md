# Linux release, distribution & update

The Linux distribution story for mermaid-collab has four phases. P1–P3 are
landed; this document covers **P4 — the portable AppImage fallback and the
update mechanism** — and ties the whole release flow together.

| Phase | Artifact | Install | Update |
|-------|----------|---------|--------|
| P1 | compiled sidecar + systemd user unit | `bun run install:linux-headless` | manual re-run |
| P2 | `mermaid-collab-server` .deb (headless) | `apt install ./...deb` | **apt repo** |
| P3 | `mermaid-collab-desktop` .deb (Electron GUI) | `apt install ./...deb` | **apt repo** |
| **P4** | **AppImage** (portable, no root) | run the file | **electron-updater self-update** |

There are two distribution channels, by design:

- **apt repo** (`.deb`) — the **primary** path for boxes that have (or can add)
  the repo and root. Both the headless server and the desktop GUI ship here, and
  updates arrive through the OS package manager (`apt update && apt upgrade`).
- **AppImage** (portable) — the **fallback** for boxes *without* the apt repo or
  *without* root. A single self-contained executable; it updates itself via
  electron-updater against a generic feed.

The macOS deploy path (`scripts/deploy-desktop.sh` / `npm run deploy`) is
independent and untouched by any of this.

---

## One-command release

```bash
# On a Linux release box / CI (electron-builder linux + dpkg + reprepro need Linux):
MC_UPDATE_FEED_URL=https://downloads.example.com/appimage \
MC_UPDATE_FEED_DIR=/srv/www/appimage \
APT_REPO_DIR=/srv/www/apt \
APT_BASE_URL=https://downloads.example.com/apt \
bun run release:linux
```

`release:linux` (`scripts/release-linux.ts`) builds **every** target then
publishes both channels:

1. `build:sidecar:linux` → `dist/mc-server-linux-x64`
2. `build:deb:server` → `dist/mermaid-collab-server_<v>_amd64.deb`
3. desktop `electron-builder` → `desktop/dist/*.AppImage`, the desktop `.deb`,
   and `latest-linux.yml` (the self-update manifest)
4. publish `.deb`s to the apt repo (`publish-apt-repo.sh`)
5. copy the AppImage + `.blockmap` + `latest-linux.yml` to `MC_UPDATE_FEED_DIR`

Flags: `--no-build` (publish already-built artifacts), `--no-publish` (build only).

---

## Channel 1 — apt repo (.deb)

`scripts/publish-apt-repo.sh` (also `bun run publish:apt`) builds a signed
[reprepro](https://salsa.debian.org/debian/reprepro) repository from every
`*.deb` under `dist/` and `desktop/dist/`. It needs `reprepro` and a GPG signing
key (`gpg --full-generate-key`, or point at one with `APT_SIGN_KEY=<id>`).

**Install on a fresh box (one-liner printed by the publish script):**

```bash
curl -fsSL https://downloads.example.com/apt/mermaid-collab-archive-keyring.gpg \
  | sudo tee /usr/share/keyrings/mermaid-collab-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/mermaid-collab-archive-keyring.gpg] https://downloads.example.com/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/mermaid-collab.list
sudo apt update && sudo apt install mermaid-collab-server   # or mermaid-collab-desktop
```

**Updates** then arrive with `sudo apt update && sudo apt upgrade`.

Env: `APT_REPO_DIR` (repo root, default `dist/apt-repo`), `APT_CODENAME`
(suite, default `stable`), `APT_SIGN_KEY`, `APT_BASE_URL` (public URL, used only
for the printed install hint).

---

## Channel 2 — AppImage (portable fallback)

The AppImage is a single executable bundling Electron **and** the compiled
sidecar (`extraResources` `mc-server`). It runs on a stock Ubuntu with no
install and no root:

```bash
chmod +x mermaid-collab-<version>-x86_64.AppImage
./mermaid-collab-<version>-x86_64.AppImage
```

It is **GUI-first** — the same desktop shell as the `.deb`, running the same
shared server on `:9002`.

### Running the AppImage headless under systemd (not the default)

For a headless box without the apt repo, the AppImage can be driven as a
service. This is **not** the recommended headless path (use the
`mermaid-collab-server` .deb / `install:linux-headless` for that) — but it works
when the .deb isn't an option:

```ini
# ~/.config/systemd/user/mermaid-collab-appimage.service
[Unit]
Description=Mermaid Collab (AppImage, headless)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=MERMAID_HEADLESS=1
# --no-sandbox + a virtual display: Electron needs a display even headless.
ExecStart=/usr/bin/xvfb-run -a %h/Apps/mermaid-collab.AppImage --no-sandbox
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now mermaid-collab-appimage.service
loginctl enable-linger "$USER"   # survive logout/reboot
```

(Needs `xvfb`. The Electron-free server .deb avoids all of this — prefer it for
real headless deployments.)

### AppImage self-update

Self-update is wired through **electron-updater** (`desktop/src/main/index.ts`
calls `autoUpdater.checkForUpdatesAndNotify()` on packaged builds). It is inert
until the build is published against a feed:

- `desktop/package.json` → `build.linux.publish` is a `generic` provider whose
  `url` is `${env.MC_UPDATE_FEED_URL}`. Set `MC_UPDATE_FEED_URL` at build time
  so electron-builder embeds the feed URL in the AppImage and emits
  `latest-linux.yml`.
- `release:linux` copies the AppImage, its `.blockmap`, and `latest-linux.yml`
  to `MC_UPDATE_FEED_DIR` (served at `MC_UPDATE_FEED_URL`).
- On next launch the running AppImage checks the feed, downloads a newer build
  (zsync/blockmap delta), and notifies the user to restart into it.

The `publish` config is scoped to `linux` only — macOS / Windows builds are
unaffected.
