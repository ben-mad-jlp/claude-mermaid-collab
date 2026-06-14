// Compile the Bun collab server to a single self-contained binary for the host
// platform, into desktop/resources/. electron-builder bundles it as extraResources;
// at runtime the Electron main spawns it with MERMAID_RESOURCES_PATH so it finds
// the (also-bundled) ui/dist + public.
//
// Cross-platform note: `bun build --compile --target=bun-<os>-<arch>` can target
// other platforms; per-OS CI is the robust path. This script builds the host target.
import { join } from 'node:path';

const here = import.meta.dir;
const repoRoot = join(here, '..', '..');
const outName = process.platform === 'win32' ? 'mc-server.exe' : 'mc-server';
const outFile = join(here, '..', 'resources', outName);

// Map the host platform to Bun's --compile target triple so the sidecar is built
// for the right OS/arch. MC_SIDECAR_TARGET overrides for cross-compilation (e.g.
// building the bun-linux-x64 sidecar from a macOS CI host). Per-OS CI remains the
// robust path; this gives a deterministic default + an explicit cross-build knob.
function hostTarget(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return `bun-windows-${arch}`;
  if (process.platform === 'linux') return `bun-linux-${arch}`;
  return `bun-darwin-${arch}`;
}
const target = process.env.MC_SIDECAR_TARGET ?? hostTarget();

console.log(`[build-sidecar] compiling src/server.ts → ${outFile} (target ${target})`);
const proc = Bun.spawnSync(
  ['bun', 'build', '--compile', `--target=${target}`, join(repoRoot, 'src', 'server.ts'), '--outfile', outFile],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' }
);
if (proc.exitCode !== 0) {
  console.error('[build-sidecar] compile failed');
  process.exit(proc.exitCode ?? 1);
}

// Bundle ffmpeg + ffprobe next to the sidecar so the (compiled, node_modules-less)
// prod binary can extract video frames. frames.ts resolves them via MERMAID_RESOURCES_PATH.
import { copyFileSync, chmodSync, existsSync as exists } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const resDir = join(here, '..', 'resources');
const exe = process.platform === 'win32' ? '.exe' : '';
try {
  const ffmpegSrc = require_('ffmpeg-static') as string;
  const ffprobeSrc = (require_('ffprobe-static') as { path: string }).path;
  for (const [src, name] of [[ffmpegSrc, `ffmpeg${exe}`], [ffprobeSrc, `ffprobe${exe}`]] as const) {
    if (src && exists(src)) {
      const dst = join(resDir, name);
      copyFileSync(src, dst);
      try { chmodSync(dst, 0o755); } catch {}
      console.log(`[build-sidecar] bundled ${name}`);
    } else {
      console.warn(`[build-sidecar] WARNING: could not find ${name} source — sprite video tools will 501 in prod`);
    }
  }
} catch (e) {
  console.warn('[build-sidecar] WARNING: ffmpeg-static/ffprobe-static not resolvable —', (e as Error).message);
}

console.log('[build-sidecar] done');
