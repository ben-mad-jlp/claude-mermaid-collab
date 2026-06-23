// build-deb-server.ts — assemble the hand-rolled `mermaid-collab-server` .deb.
//
// This is the PRIMARY Linux artifact (Linux P2): the Electron-free headless
// install, productizing P1's install-linux-headless.sh as a distro-native
// package. It stages the compiled Bun sidecar + the systemd user unit + the P0
// port handshake into a debian package tree and runs `dpkg-deb --build`.
//
//   in:  dist/mc-server-linux-x64            (from `bun run build:sidecar:linux`)
//        scripts/debian/server/*             (control.tmpl, maintainer scripts, unit)
//        scripts/mc-port-handshake.sh        (shared with the P1 installer)
//   out: dist/mermaid-collab-server_<version>_amd64.deb
//
// FHS layout inside the package:
//   /usr/lib/mermaid-collab/mc-server                  (0755, compiled binary)
//   /usr/lib/mermaid-collab/mc-port-handshake.sh       (0755)
//   /usr/lib/systemd/user/mermaid-collab.service       (0644, packaged user unit)
//
// dpkg-deb is a Linux tool; on a macOS dev box this script errors with a hint to
// run it in Linux CI / on the target box (same split as P1's cross-compile flow:
// compile the binary on macOS, build/install the package on Linux).
import { join } from 'node:path';
import {
  mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync,
  chmodSync, existsSync, statSync, readdirSync,
} from 'node:fs';

const here = import.meta.dir;
const repoRoot = join(here, '..');
const debSrc = join(here, 'debian', 'server');
const outDir = join(repoRoot, 'dist');

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version as string;
const pkgName = `mermaid-collab-server_${version}_amd64`;
const stageDir = join(outDir, 'deb', pkgName);
const debOut = join(outDir, `${pkgName}.deb`);

const binSrc = join(outDir, 'mc-server-linux-x64');
const handshakeSrc = join(repoRoot, 'scripts', 'mc-port-handshake.sh');

const log = (m: string) => console.log(`[build-deb-server] ${m}`);
const die = (m: string): never => { console.error(`[build-deb-server] ERROR: ${m}`); process.exit(1); };

// ── preconditions ────────────────────────────────────────────────────────────
if (!existsSync(binSrc)) {
  die(`compiled sidecar missing: ${binSrc}\n  build it first:  bun run build:sidecar:linux`);
}
if (!existsSync(handshakeSrc)) die(`handshake script missing: ${handshakeSrc}`);

const hasDpkg = Bun.spawnSync(['sh', '-c', 'command -v dpkg-deb']).exitCode === 0;

// ── stage the package tree ───────────────────────────────────────────────────
log(`staging ${pkgName} → ${stageDir}`);
rmSync(stageDir, { recursive: true, force: true });

const usrLib = join(stageDir, 'usr', 'lib', 'mermaid-collab');
const unitDir = join(stageDir, 'usr', 'lib', 'systemd', 'user');
const debianDir = join(stageDir, 'DEBIAN');
for (const d of [usrLib, unitDir, debianDir]) mkdirSync(d, { recursive: true });

// payload
copyFileSync(binSrc, join(usrLib, 'mc-server'));
chmodSync(join(usrLib, 'mc-server'), 0o755);
copyFileSync(handshakeSrc, join(usrLib, 'mc-port-handshake.sh'));
chmodSync(join(usrLib, 'mc-port-handshake.sh'), 0o755);
copyFileSync(join(debSrc, 'mermaid-collab.service'), join(unitDir, 'mermaid-collab.service'));
chmodSync(join(unitDir, 'mermaid-collab.service'), 0o644);

// maintainer scripts (must be executable)
for (const s of ['postinst', 'prerm', 'postrm']) {
  copyFileSync(join(debSrc, s), join(debianDir, s));
  chmodSync(join(debianDir, s), 0o755);
}

// control — fill version + Installed-Size (KiB, dpkg convention)
const installedSize = Math.max(1, Math.ceil(statSync(join(usrLib, 'mc-server')).size / 1024));
const control = readFileSync(join(debSrc, 'control.tmpl'), 'utf-8')
  .replace('__VERSION__', version)
  .replace('__INSTALLED_SIZE__', String(installedSize));
writeFileSync(join(debianDir, 'control'), control);

// Strip inherited setgid/group bits from every staged directory. dpkg-deb
// rejects a control directory whose perms fall outside 0755..0775, and a
// setgid parent dir (common on group-shared checkouts: drwxrwsr-x) makes
// mkdir produce 2775. Normalize to 0755 so the pack step is host-agnostic.
const normalizeDirPerms = (dir: string): void => {
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) normalizeDirPerms(join(dir, e.name));
  }
};
normalizeDirPerms(stageDir);

// ── build the .deb ───────────────────────────────────────────────────────────
if (!hasDpkg) {
  log(`staged package tree is ready at ${stageDir}`);
  die(
    'dpkg-deb not found — cannot assemble the .deb on this host.\n' +
    '  Run on Linux (CI or the target box):  bun run build:deb:server\n' +
    '  The staged DEBIAN/ tree above is complete; only the final pack step is missing.',
  );
}

log(`building ${debOut}`);
const proc = Bun.spawnSync(
  ['dpkg-deb', '--root-owner-group', '--build', stageDir, debOut],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' },
);
if (proc.exitCode !== 0) die('dpkg-deb --build failed');
log(`done → ${debOut}`);
log(`install on the target box:  sudo apt install ./${pkgName}.deb`);
