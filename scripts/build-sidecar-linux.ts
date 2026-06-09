// Compile the Bun collab server to a single self-contained Linux/x64 binary.
//
// Unlike desktop/scripts/build-sidecar.ts (which targets the HOST platform for
// electron-builder), this always targets bun-linux-x64 so a macOS dev box can
// cross-compile the headless sidecar that runs under systemd on a Linux server.
// `bun build --compile --target=bun-linux-x64` bundles the Bun runtime, so the
// resulting binary has NO bun-on-PATH dependency on the target machine.
//
// Output: dist/mc-server-linux-x64  (consumed by scripts/install-linux-headless.sh)
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = import.meta.dir;
const repoRoot = join(here, '..');
const outDir = join(repoRoot, 'dist');
const outFile = join(outDir, 'mc-server-linux-x64');

mkdirSync(outDir, { recursive: true });

console.log(`[build-sidecar-linux] compiling src/server.ts → ${outFile} (target=bun-linux-x64)`);
const proc = Bun.spawnSync(
  [
    'bun', 'build', '--compile', '--target=bun-linux-x64',
    join(repoRoot, 'src', 'server.ts'),
    '--outfile', outFile,
  ],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' },
);
if (proc.exitCode !== 0) {
  console.error('[build-sidecar-linux] compile failed');
  process.exit(proc.exitCode ?? 1);
}
console.log('[build-sidecar-linux] done');
