// release-linux.ts — one-command Linux release: build EVERY target, then publish.
//
// This is the Linux analogue of the macOS scripts/deploy-desktop.sh — but where
// the macOS script hot-swaps artifacts into an already-installed .app on the dev
// box, the Linux release builds distributable packages and pushes them to an
// update feed so any number of remote boxes pull the new version themselves:
//
//   .deb  → apt repo (reprepro)            → `apt update && apt upgrade`
//   AppImage → generic update feed (yml)   → electron-updater self-update
//
// The macOS deploy path (deploy-desktop.sh / `npm run deploy`) is left entirely
// untouched — this is additive.
//
// Targets built (in order):
//   1. dist/mc-server-linux-x64                       (build:sidecar:linux)
//   2. dist/mermaid-collab-server_<v>_amd64.deb       (build:deb:server, reprepro-able)
//   3. desktop AppImage + desktop .deb                (electron-builder linux)
//      → desktop/dist/*.AppImage, *.deb, latest-linux.yml
//
// Publish (unless --no-publish):
//   • apt repo via scripts/publish-apt-repo.sh           (all *.deb)
//   • AppImage + latest-linux.yml copied to the update feed dir (MC_UPDATE_FEED_DIR)
//
// Usage:
//   bun run release:linux                 # build all + publish
//   bun run release:linux --no-publish    # build all, skip publishing
//   bun run release:linux --no-build      # publish already-built artifacts
//
// Env:
//   MC_UPDATE_FEED_DIR   local dir backing MC_UPDATE_FEED_URL (where the AppImage
//                        + latest-linux.yml are copied for self-update). Required
//                        to publish the AppImage feed; the .deb apt repo path is
//                        independent (APT_REPO_DIR / APT_BASE_URL — see publish-apt-repo.sh).
import { join } from 'node:path';
import {
  existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync,
} from 'node:fs';

const here = import.meta.dir;
const repoRoot = join(here, '..');
const desktopDir = join(repoRoot, 'desktop');
const distDir = join(repoRoot, 'dist');
const desktopDist = join(desktopDir, 'dist');

const args = new Set(process.argv.slice(2));
const doBuild = !args.has('--no-build');
const doPublish = !args.has('--no-publish');

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version as string;

const log = (m: string) => console.log(`\x1b[1;36m[release-linux]\x1b[0m ${m}`);
const die = (m: string): never => { console.error(`\x1b[1;31m[release-linux] ERROR:\x1b[0m ${m}`); process.exit(1); };

// Linux-only: electron-builder's linux targets + dpkg/reprepro need a Linux host.
if (process.platform !== 'linux') {
  die(
    `Linux release must run on Linux (got ${process.platform}).\n` +
    '  The compiled sidecar can be cross-built on macOS (bun run build:sidecar:linux),\n' +
    '  but electron-builder linux targets + dpkg-deb + reprepro require a Linux box / CI.',
  );
}

const run = (cmd: string[], cwd = repoRoot) => {
  log(`$ ${cmd.join(' ')}`);
  const p = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) die(`command failed (${p.exitCode}): ${cmd.join(' ')}`);
};

// ── build ────────────────────────────────────────────────────────────────────
if (doBuild) {
  log('1/3 compiling headless Linux sidecar…');
  run(['bun', 'run', 'build:sidecar:linux']);

  log('2/3 building mermaid-collab-server .deb…');
  run(['bun', 'run', 'build:deb:server']);

  log('3/3 building desktop AppImage + .deb (electron-builder)…');
  // `dist` runs build:ui + build (electron-vite) + build:sidecar (host=linux) +
  // electron-builder, which emits the AppImage, the desktop .deb, and the
  // latest-linux.yml self-update manifest into desktop/dist/.
  run(['npm', 'run', 'dist'], desktopDir);
} else {
  log('--no-build: publishing already-built artifacts');
}

// ── collect artifacts ─────────────────────────────────────────────────────────
const lsDebs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.deb')).map((f) => join(dir, f)) : [];
const debs = [...lsDebs(distDir), ...lsDebs(desktopDist)];
const appImages = existsSync(desktopDist)
  ? readdirSync(desktopDist).filter((f) => f.endsWith('.AppImage')).map((f) => join(desktopDist, f))
  : [];

log(`artifacts: ${debs.length} .deb, ${appImages.length} AppImage (v${version})`);
debs.forEach((d) => log(`  deb      ${d}`));
appImages.forEach((a) => log(`  appimage ${a}`));

if (!doPublish) {
  log('--no-publish: built artifacts left in place. Done.');
  process.exit(0);
}

// ── publish: apt repo (.deb) ──────────────────────────────────────────────────
if (debs.length) {
  log('publishing .deb packages to the apt repo…');
  run(['bash', join(here, 'publish-apt-repo.sh')]);
} else {
  log('no .deb artifacts found — skipping apt repo publish');
}

// ── publish: AppImage self-update feed ────────────────────────────────────────
const feedDir = process.env.MC_UPDATE_FEED_DIR;
if (appImages.length) {
  if (!feedDir) {
    die(
      'AppImage built but MC_UPDATE_FEED_DIR is unset — cannot publish the self-update feed.\n' +
      '  Set MC_UPDATE_FEED_DIR to the local dir served at MC_UPDATE_FEED_URL, or pass --no-publish.',
    );
  }
  mkdirSync(feedDir, { recursive: true });
  // electron-updater needs the AppImage, its .blockmap (delta updates), and the
  // latest-linux.yml manifest co-located at the feed root.
  const manifests = readdirSync(desktopDist).filter(
    (f) => f === 'latest-linux.yml' || f.endsWith('.AppImage.blockmap'),
  );
  for (const f of [...appImages.map((p) => p.split('/').pop()!), ...manifests]) {
    copyFileSync(join(desktopDist, f), join(feedDir, f));
    log(`  → ${join(feedDir, f)}`);
  }
  if (!manifests.includes('latest-linux.yml')) {
    log('  WARN: latest-linux.yml not found in desktop/dist — electron-updater needs it; ' +
        'confirm linux.publish is configured (it embeds the feed url in the AppImage).');
  }
  log(`AppImage self-update feed published to ${feedDir}`);
} else {
  log('no AppImage artifact found — skipping self-update feed publish');
}

log('\x1b[1;32mDONE\x1b[0m — Linux release built + published.');
