/**
 * deploy-verify — build identity and deployed-build verification.
 *
 * A build manifest records the git HEAD, asar hash, sidecar hash, UI bundle,
 * and build timestamp at the time the desktop app was packaged. This module
 * verifies that the running deployed build matches the recorded manifest,
 * detecting stale/mismatched builds through a series of checks.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Build identity recorded at package time. */
export interface BuildManifest {
  headSha: string;
  asarSha256: string;
  sidecarSha256: string;
  uiBundle: string;
  builtAt: number;
}

/** Closed union of mismatch reasons detected by verifyDeployedBuild. */
export type DeployMismatch =
  | 'head-sha-mismatch'
  | 'served-owner-not-app'
  | 'ui-bundle-mismatch'
  | 'asar-hash-mismatch'
  | 'main-build-sha-mismatch'
  | 'manifest-missing';

/** Injected deps for buildManifest (pure function, no fs/git/clock calls in the unit path). */
export interface BuildManifestDeps {
  /** Current HEAD commit SHA. */
  headSha(): string;
  /** Compute SHA256 hash of a file. */
  sha256(path: string): string;
  /** Read file as text. */
  readText(path: string): string;
  /** Absolute path to the asar bundle. */
  asarPath: string;
  /** Absolute path to the sidecar executable. */
  sidecarPath: string;
  /** Absolute path to index.html. */
  indexHtmlPath: string;
  /** Current epoch-ms. */
  now(): number;
}

/** Compute build manifest from injected readers (pure, deterministic). */
export function buildManifest(deps: BuildManifestDeps): BuildManifest {
  return {
    headSha: deps.headSha(),
    asarSha256: deps.sha256(deps.asarPath),
    sidecarSha256: deps.sha256(deps.sidecarPath),
    uiBundle: parseUiBundle(deps.readText(deps.indexHtmlPath)) || 'unknown',
    builtAt: deps.now(),
  };
}

/** Extract the index-<hash>.js basename from index.html; null if not found. */
export function parseUiBundle(html: string): string | null {
  const match = html.match(/index-[a-f0-9]+\.js/);
  return match ? match[0] : null;
}

/** Absolute path of the build manifest in the Resources dir. */
export function buildManifestPath(resourcesPath: string): string {
  return join(resourcesPath, 'build-manifest.json');
}

/** Write build manifest to <Resources>/build-manifest.json. */
export function writeBuildManifest(resourcesPath: string, m: BuildManifest): void {
  mkdirSync(resourcesPath, { recursive: true });
  writeFileSync(buildManifestPath(resourcesPath), JSON.stringify(m, null, 2));
}

/** Read build manifest from <Resources>/build-manifest.json; null on missing/malformed. */
export function readBuildManifest(resourcesPath: string): BuildManifest | null {
  try {
    const raw = readFileSync(buildManifestPath(resourcesPath), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const m = parsed as Record<string, unknown>;
    if (typeof m.headSha !== 'string') return null;
    if (typeof m.asarSha256 !== 'string') return null;
    if (typeof m.sidecarSha256 !== 'string') return null;
    if (typeof m.uiBundle !== 'string') return null;
    if (typeof m.builtAt !== 'number') return null;
    return parsed as BuildManifest;
  } catch {
    return null;
  }
}

/** Injected deps for verifyDeployedBuild. */
export interface VerifyDeployDeps {
  /** Absolute path to the Resources directory. */
  resourcesPath: string;
  /** Absolute path to the app bundle (macOS .app); optional, used only for servedOwnerOk. */
  appPath?: string;
  /** Expected HEAD commit SHA (from the running daemon's repo). */
  expectedHeadSha(): string | Promise<string>;
  /** Read build manifest; defaults to readBuildManifest. */
  readManifest?: (resourcesPath: string) => BuildManifest | null;
  /** Fetch /api/health to get served identity (exePath, owner). */
  health(): Promise<{ exePath?: string; owner?: string } | null>;
  /** Fetch /api/v1/system/health or equivalent to get served index.html. */
  servedIndexHtml(): Promise<string | null>;
  /** Compute SHA256 of the on-disk asar; null if uncomputable. */
  hashAsar(): string | null;
  /** Fetch /main/ping to get control-channel build identity; undefined if no control channel. */
  mainPing?: () => Promise<{ buildSha?: string } | null>;
}

/**
 * Verify that the executed path is allowed (not a shadow, not something else).
 * A src/server.ts shadow server answering on :9002 is not an app (shadows the mode-C
 * cosmetic deploy). The precedence is:
 *   1. If exePath contains /src/server.ts, NOT ok (shadow).
 *   2. If exePath is under <APP_PATH>/Contents/..., ok.
 *   3. If exePath is under <APP_PATH>/Resources/mc-server, ok.
 *   4. Otherwise, not ok.
 */
export function servedOwnerOk(exePath: string | undefined, opts: { resourcesPath: string; appPath?: string }): boolean {
  if (!exePath) return false;
  // Shadow check (wins over everything else).
  if (exePath.includes('/src/server.ts')) return false;
  // App bundle checks (only if appPath is provided).
  if (opts.appPath) {
    if (exePath.startsWith(opts.appPath + '/Contents/')) return true;
    if (exePath.startsWith(opts.appPath + '/Resources/mc-server')) return true;
  }
  return false;
}

/** Verify that the deployed build matches the manifest. */
export async function verifyDeployedBuild(deps: VerifyDeployDeps): Promise<{ ok: boolean; mismatches: DeployMismatch[] }> {
  const mismatches: DeployMismatch[] = [];

  // 1. Manifest present.
  const readManifest = deps.readManifest ?? readBuildManifest;
  let manifest: BuildManifest | null = null;
  try {
    manifest = readManifest(deps.resourcesPath);
  } catch {
    // Treat throwing as a missing manifest.
    manifest = null;
  }
  if (!manifest) {
    mismatches.push('manifest-missing');
    // Skip checks 2, 4, 5, 6 when manifest is missing; 3 (served-owner) still runs.
  } else {
    // 2. HEAD SHA matches.
    try {
      const expectedHead = await deps.expectedHeadSha();
      if (expectedHead !== manifest.headSha) {
        mismatches.push('head-sha-mismatch');
      }
    } catch {
      mismatches.push('head-sha-mismatch');
    }

    // 4. UI bundle matches.
    try {
      const served = await deps.servedIndexHtml();
      const servedBundle = parseUiBundle(served || '');
      if (servedBundle !== manifest.uiBundle) {
        mismatches.push('ui-bundle-mismatch');
      }
    } catch {
      mismatches.push('ui-bundle-mismatch');
    }

    // 5. Asar hash matches.
    try {
      const asarHash = deps.hashAsar();
      if (!asarHash || asarHash !== manifest.asarSha256) {
        mismatches.push('asar-hash-mismatch');
      }
    } catch {
      mismatches.push('asar-hash-mismatch');
    }

    // 6. Main build SHA matches (if control channel present).
    if (deps.mainPing) {
      try {
        const ping = await deps.mainPing();
        if (ping && ping.buildSha && ping.buildSha !== manifest.headSha) {
          mismatches.push('main-build-sha-mismatch');
        }
        // If ping is null or has no buildSha, contribute nothing (control channel absent).
      } catch {
        // Control channel unavailable; contribute nothing.
      }
    }
  }

  // 3. Served owner ok (runs regardless of manifest).
  try {
    const health = await deps.health();
    const exePath = health?.exePath;
    if (!servedOwnerOk(exePath, deps)) {
      mismatches.push('served-owner-not-app');
    }
  } catch {
    mismatches.push('served-owner-not-app');
  }

  return { ok: mismatches.length === 0, mismatches };
}
