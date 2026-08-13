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

/**
 * Neutralize jsdom's build-time `require.resolve` of its synchronous-XHR worker.
 *
 * WHY (incident 2026-08-05): jsdom's XMLHttpRequest-impl.js runs, at MODULE LOAD,
 *   const syncWorkerFile = require.resolve ? require.resolve("./xhr-sync-worker.js") : null;
 * `bun build --compile` cannot embed a file reached that way, so it bakes the BUILDER'S
 * absolute path into the binary and defers the resolve to runtime. The sidecar then only
 * starts on a machine where the builder's node_modules is present AND readable. It ran for
 * a year purely because the build host and the run host were the same checkout; the day
 * /home/ben went 0750, every OTHER user's app died at startup with
 *   Cannot find module /home/ben/.../jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js
 *   from /$bunfs/root/mc-server
 * A shipped binary must not reference the machine that built it.
 *
 * `null` is a value jsdom already anticipates on that line (the `: null` branch). The file
 * is ONLY read at XMLHttpRequest-impl.js:589, to spawn a worker for a SYNCHRONOUS XHR —
 * `xhr.open(..., false)`. The sidecar loads jsdom for one reason: to give mermaid and
 * dompurify a DOM for server-side diagram rendering. That path issues no XHR at all, let
 * alone a synchronous one. If a future dependency ever does, it throws there instead of
 * silently misbehaving — a loud failure at the call site, not a dead server at boot.
 *
 * There are TWO leaking patterns, in two different jsdom copies — the top-level `jsdom`
 * (23.x) and the one nested under `isomorphic-dompurify` (27.x):
 *   1. XMLHttpRequest-impl.js — `require.resolve("./xhr-sync-worker.js")` (both copies).
 *   2. living/helpers/style-rules.js — `fs.readFileSync(path.resolve(__dirname, ...))`
 *      of default-stylesheet.css (27.x only; 23.x `require`s it, which bundles fine).
 * Each patch is BEST-EFFORT and silent when its pattern is absent, because the two copies
 * legitimately differ and will drift again on upgrade. The invariant is NOT "these strings
 * matched" — it is the post-build leak gate below, which checks the thing that actually
 * harms users. A new jsdom that leaks a third way fails the build there, loudly.
 */
const unbakeBuilderPaths: import('bun').BunPlugin = {
  name: 'unbake-builder-paths',
  setup(build) {
    build.onLoad({ filter: /jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      // Two spellings across jsdom versions, both resolving the same worker file:
      //   23.x/27.x:  require.resolve ? require.resolve("./xhr-sync-worker.js") : null
      //   28.x:       require.resolve("./xhr-sync-worker.js")
      // Match the guarded form FIRST so its `: null` tail is consumed as part of the
      // expression rather than left dangling by the bare-call rule.
      const resolveCall =
        /require\.resolve\s*\?\s*require\.resolve\(\s*"\.\/xhr-sync-worker\.js"\s*\)\s*:\s*null|require\.resolve\(\s*"\.\/xhr-sync-worker\.js"\s*\)/g;
      if (!resolveCall.test(src)) return undefined;
      resolveCall.lastIndex = 0;
      return { contents: src.replace(resolveCall, 'null'), loader: 'js' };
    });

    // Inline default-stylesheet.css as a literal so no __dirname survives into the binary.
    // Read at BUILD time from the copy that sits beside this very module, so each jsdom
    // gets its own stylesheet rather than one copy's leaking into the other.
    build.onLoad({ filter: /jsdom[\\/]living[\\/]helpers[\\/]style-rules\.js$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      const call = /fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\)/;
      if (!call.test(src)) return undefined;
      const cssPath = join(args.path, '..', '..', '..', 'browser', 'default-stylesheet.css');
      const css = await Bun.file(cssPath).text();
      return { contents: src.replace(call, JSON.stringify(css)), loader: 'js' };
    });
  },
};

console.log(`[build-sidecar] compiling src/server.ts → ${outFile} (target ${target})`);
const result = await Bun.build({
  entrypoints: [join(repoRoot, 'src', 'server.ts')],
  target: 'bun',
  compile: { outfile: outFile, target },
  plugins: [unbakeBuilderPaths],
} as Parameters<typeof Bun.build>[0]);
if (!result.success) {
  console.error('[build-sidecar] compile failed');
  for (const l of result.logs) console.error(String(l));
  process.exit(1);
}

// GATE: a shipped binary must not depend on the machine that built it. Any absolute path
// into the builder's checkout is that dependency, and it fails ONLY for other users — the
// build host can never notice it by running the thing. So assert it here, at build time.
{
  const bin = new Uint8Array(await Bun.file(outFile).arrayBuffer());
  const hay = new TextDecoder('latin1').decode(bin);
  const leaked = [...new Set(
    [...hay.matchAll(/(?:\/home\/[^\0"'\s]{0,120}|\/Users\/[^\0"'\s]{0,120})node_modules\/[^\0"'\s]{0,120}/g)]
      .map((m) => m[0]),
  )];
  if (leaked.length > 0) {
    console.error('[build-sidecar] REFUSING to ship: builder-machine paths baked into the binary:');
    for (const p of leaked.slice(0, 10)) console.error(`  ${p}`);
    console.error('  These resolve at RUNTIME. The sidecar would start only on this checkout.');
    process.exit(1);
  }
  console.log('[build-sidecar] no builder-machine paths in binary ✓');
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
