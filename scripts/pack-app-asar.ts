// pack-app-asar.ts — package and sign Electron main (app.asar) with build manifest.
//
// Stages desktop/out (the electron-vite build) + desktop/package.json into a
// directory, packs it with asar, and records the build identity (git HEAD, asar hash,
// sidecar hash, UI bundle) in a build-manifest.json so deploy-verify can detect
// stale/mismatched builds.
//
// Usage:
//   bun run scripts/pack-app-asar.ts              # build + pack
//   bun run scripts/pack-app-asar.ts --no-build   # pack existing desktop/out
//   bun run scripts/pack-app-asar.ts --repo <dir> # override repo root
//
// Output: desktop/out-asar/app.asar + desktop/out-asar/build-manifest.json

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, copyFileSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildManifest, writeBuildManifest, BuildManifest, buildManifestPath,
} from '../src/services/deploy-verify';

export interface PackAppAsarOptions {
  repoRoot: string;
  outDir?: string;          // default <repoRoot>/desktop/out
  packageJsonPath?: string; // default <repoRoot>/desktop/package.json
  stageDir?: string;        // scratch staging root (default <repoRoot>/desktop/out-asar/stage)
  asarOut?: string;         // default <repoRoot>/desktop/out-asar/app.asar
  manifestDir?: string;     // default <repoRoot>/desktop/out-asar (writeBuildManifest target)
  sidecarPath?: string;     // default <repoRoot>/desktop/resources/mc-server
  indexHtmlPath?: string;   // default <repoRoot>/ui/dist/index.html
  doBuild?: boolean;        // false ⇒ skip electron-vite build (default true)
  // injected seams so the unit test needs no electron-vite / asar binary:
  runBuild?: () => void;
  packAsar?: (stageDir: string, asarOut: string) => void;
  headSha?: () => string;
  now?: () => number;
}

const defaultOptions = (opts: Partial<PackAppAsarOptions> & { repoRoot: string }): Required<PackAppAsarOptions> => ({
  repoRoot: opts.repoRoot,
  outDir: opts.outDir ?? join(opts.repoRoot, 'desktop', 'out'),
  packageJsonPath: opts.packageJsonPath ?? join(opts.repoRoot, 'desktop', 'package.json'),
  stageDir: opts.stageDir ?? join(opts.repoRoot, 'desktop', 'out-asar', 'stage'),
  asarOut: opts.asarOut ?? join(opts.repoRoot, 'desktop', 'out-asar', 'app.asar'),
  manifestDir: opts.manifestDir ?? join(opts.repoRoot, 'desktop', 'out-asar'),
  sidecarPath: opts.sidecarPath ?? join(opts.repoRoot, 'desktop', 'resources', 'mc-server'),
  indexHtmlPath: opts.indexHtmlPath ?? join(opts.repoRoot, 'ui', 'dist', 'index.html'),
  doBuild: opts.doBuild ?? true,
  runBuild: opts.runBuild ?? (() => {
    const desktopDir = join(opts.repoRoot, 'desktop');
    const result = spawnSync('electron-vite', ['build'], {
      cwd: desktopDir,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`electron-vite build failed with exit code ${result.status ?? 1}`);
    }
  }),
  packAsar: opts.packAsar ?? ((stageDir: string, asarOut: string) => {
    const asarBin = join(opts.repoRoot, 'desktop', 'node_modules', '.bin', 'asar');
    const result = spawnSync('node', [asarBin, 'pack', stageDir, asarOut], {
      cwd: opts.repoRoot,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`asar pack failed with exit code ${result.status ?? 1}`);
    }
  }),
  headSha: opts.headSha ?? (() => {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: opts.repoRoot,
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      throw new Error('git rev-parse HEAD failed');
    }
    return (result.stdout ?? '').trim();
  }),
  now: opts.now ?? (() => Date.now()),
});

export async function packAppAsar(
  opts: Partial<PackAppAsarOptions> & { repoRoot: string },
): Promise<{ asarPath: string; manifestPath: string; manifest: BuildManifest }> {
  const resolved = defaultOptions(opts);

  // 1. Build if requested
  if (resolved.doBuild) {
    resolved.runBuild();
  }

  // 2. Fail loud if outDir is missing
  try {
    readFileSync(join(resolved.outDir, 'main', 'index.js'), 'utf-8');
  } catch {
    throw new Error(`desktop/out missing or incomplete — electron-vite build may have failed. Looked for: ${resolved.outDir}/main/index.js`);
  }

  // 3. Stage: rm+recreate stageDir, copy out + package.json
  try {
    rmSync(resolved.stageDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(resolved.stageDir, { recursive: true });
  cpSync(resolved.outDir, join(resolved.stageDir, 'out'), { recursive: true });
  copyFileSync(resolved.packageJsonPath, join(resolved.stageDir, 'package.json'));

  // 4. Pack with asar
  resolved.packAsar(resolved.stageDir, resolved.asarOut);

  // Verify the output exists
  try {
    readFileSync(resolved.asarOut);
  } catch {
    throw new Error(`asar pack produced no output at: ${resolved.asarOut}`);
  }

  // 5. Create manifest and write it
  const manifest = buildManifest({
    headSha: resolved.headSha,
    sha256: (path: string) => {
      try {
        const content = readFileSync(path);
        return createHash('sha256').update(content).digest('hex');
      } catch {
        return '';
      }
    },
    readText: (path: string) => {
      try {
        return readFileSync(path, 'utf-8');
      } catch {
        return '';
      }
    },
    asarPath: resolved.asarOut,
    sidecarPath: resolved.sidecarPath,
    indexHtmlPath: resolved.indexHtmlPath,
    now: resolved.now,
  });

  mkdirSync(resolved.manifestDir, { recursive: true });
  writeBuildManifest(resolved.manifestDir, manifest);

  return {
    asarPath: resolved.asarOut,
    manifestPath: buildManifestPath(resolved.manifestDir),
    manifest,
  };
}

// CLI entrypoint
if (import.meta.main) {
  const here = import.meta.dir;
  const repoRoot = join(here, '..');
  const args = new Set(process.argv.slice(2));

  let repo = repoRoot;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--repo' && i + 1 < process.argv.length) {
      repo = process.argv[i + 1];
      break;
    }
  }

  const doBuild = !args.has('--no-build');

  try {
    const result = await packAppAsar({ repoRoot: repo, doBuild });
    console.log(`[pack-app-asar] done: ${result.asarPath}`);
    console.log(`[pack-app-asar] headSha: ${result.manifest.headSha}`);
  } catch (err) {
    console.error(`[pack-app-asar] ${(err as Error).message}`);
    process.exit(1);
  }
}
