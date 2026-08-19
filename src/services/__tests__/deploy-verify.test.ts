import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BuildManifest,
  buildManifest,
  buildManifestPath,
  writeBuildManifest,
  readBuildManifest,
  parseUiBundle,
  compareBundleHashes,
  servedOwnerOk,
  verifyDeployedBuild,
  type HashSide,
  type DeployIndeterminate,
} from '../deploy-verify';
import { readSelfDeployStatus, writeDeployVerification, deployLogDir, deployStatusPath } from '../deploy-service';
import { _closeAllCollabDbs } from '../collab-db';

let supDir: string;

beforeEach(() => {
  supDir = mkdtempSync(join(tmpdir(), 'sup-'));
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
});

afterEach(() => {
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(supDir, { recursive: true, force: true });
});

describe('parseUiBundle', () => {
  test('extracts index-<hash>.js from a script tag', () => {
    const html = '<html><script src="index-abc123def456.js"></script></html>';
    expect(parseUiBundle(html)).toBe('index-abc123def456.js');
  });

  test('returns null when no bundle found', () => {
    expect(parseUiBundle('<html></html>')).toBeNull();
    expect(parseUiBundle('random text')).toBeNull();
  });
});

describe('compareBundleHashes / indeterminate verification', () => {
  test('unknown on both sides is indeterminate, never a mismatch', () => {
    const result = compareBundleHashes('unknown', 'unknown', 'ui-bundle');
    expect(result.kind).toBe('indeterminate');
    expect(result.kind === 'indeterminate' && result.unresolvedSide).toBe('both');
    expect(result.kind === 'indeterminate' && result.reason).toBeTruthy();
    expect(result.kind).not.toBe('mismatch');
  });

  test('two distinct resolved hashes are a mismatch', () => {
    const result = compareBundleHashes('index-aaa.js', 'index-bbb.js', 'ui-bundle');
    expect(result.kind).toBe('mismatch');
  });

  test('verifyDeployedBuild records an indeterminate ui-bundle instead of a mismatch', async () => {
    const resPath = mkdtempSync(join(tmpdir(), 'res-'));
    try {
      const m: BuildManifest = {
        headSha: 'sha',
        asarSha256: 'asar',
        sidecarSha256: 'sidecar',
        uiBundle: 'unknown',
        builtAt: 1000,
      };
      writeBuildManifest(resPath, m);

      const result = await verifyDeployedBuild({
        resourcesPath: resPath,
        expectedHeadSha: () => 'sha',
        readManifest: () => m,
        health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
        servedIndexHtml: () => Promise.resolve('<html></html>'), // No parseable bundle
        hashAsar: () => 'asar',
        appPath: '/app',
      });

      expect(result.mismatches).not.toContain('ui-bundle-mismatch');
      expect(result.indeterminate.length).toBe(1);
      expect(result.indeterminate[0].check).toBe('ui-bundle');
      expect(result.indeterminate[0].unresolvedSide).toBeTruthy();
      expect(result.indeterminate[0].reason).toBeTruthy();
    } finally {
      rmSync(resPath, { recursive: true, force: true });
    }
  });
});

describe('buildManifest', () => {
  test('computes manifest from injected deps', () => {
    const deps = {
      headSha: () => 'abc123',
      sha256: (path: string) => (path.includes('asar') ? 'asar-hash' : 'sidecar-hash'),
      readText: (path: string) => '<script src="index-abc123.js"></script>',
      asarPath: '/app/app.asar',
      sidecarPath: '/app/server',
      indexHtmlPath: '/app/index.html',
      now: () => 1234567890,
    };
    const m = buildManifest(deps);
    expect(m.headSha).toBe('abc123');
    expect(m.asarSha256).toBe('asar-hash');
    expect(m.sidecarSha256).toBe('sidecar-hash');
    expect(m.uiBundle).toBe('index-abc123.js');
    expect(m.builtAt).toBe(1234567890);
  });
});

describe('writeBuildManifest + readBuildManifest', () => {
  test('writes and reads a manifest correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    try {
      const m: BuildManifest = {
        headSha: 'sha1',
        asarSha256: 'asar1',
        sidecarSha256: 'sidecar1',
        uiBundle: 'index-bundle.js',
        builtAt: 1000,
      };
      writeBuildManifest(dir, m);
      const read = readBuildManifest(dir);
      expect(read).toEqual(m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null when file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    try {
      const read = readBuildManifest(dir);
      expect(read).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null on malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    try {
      writeFileSync(buildManifestPath(dir), '{bad json');
      const read = readBuildManifest(dir);
      expect(read).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null when a required field is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    try {
      writeFileSync(buildManifestPath(dir), JSON.stringify({ headSha: 'x', asarSha256: 'y' }));
      const read = readBuildManifest(dir);
      expect(read).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null when a field has the wrong type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    try {
      writeFileSync(
        buildManifestPath(dir),
        JSON.stringify({
          headSha: 'x',
          asarSha256: 'y',
          sidecarSha256: 'z',
          uiBundle: 'index-abc123.js',
          builtAt: 'not-a-number', // wrong type
        }),
      );
      const read = readBuildManifest(dir);
      expect(read).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('servedOwnerOk', () => {
  test('returns false when exePath is undefined', () => {
    const result = servedOwnerOk(undefined, { resourcesPath: '/res' });
    expect(result).toBe(false);
  });

  test('returns false when exePath is empty', () => {
    const result = servedOwnerOk('', { resourcesPath: '/res' });
    expect(result).toBe(false);
  });

  test('returns false for a shadow (src/server.ts)', () => {
    const result = servedOwnerOk('/path/to/src/server.ts', { resourcesPath: '/res', appPath: '/app' });
    expect(result).toBe(false);
  });

  test('returns true for an app path (Contents)', () => {
    const result = servedOwnerOk('/app/Contents/MacOS/server', { resourcesPath: '/res', appPath: '/app' });
    expect(result).toBe(true);
  });

  test('returns true for an app path (Resources/mc-server)', () => {
    const result = servedOwnerOk('/app/Resources/mc-server', { resourcesPath: '/res', appPath: '/app' });
    expect(result).toBe(true);
  });

  test('returns false for a path not under the app', () => {
    const result = servedOwnerOk('/some/other/path', { resourcesPath: '/res', appPath: '/app' });
    expect(result).toBe(false);
  });

  test('returns false when appPath is not provided and exePath is not a shadow', () => {
    const result = servedOwnerOk('/some/random/path', { resourcesPath: '/res' });
    expect(result).toBe(false);
  });

  test('shadow check wins over app-path checks', () => {
    const result = servedOwnerOk('/app/Contents/src/server.ts', { resourcesPath: '/res', appPath: '/app' });
    expect(result).toBe(false);
  });
});

describe('verifyDeployedBuild — per-mismatch tests', () => {
  const baseResPath = mkdtempSync(join(tmpdir(), 'res-'));

  afterEach(() => {
    rmSync(baseResPath, { recursive: true, force: true });
  });

  test('head-sha-mismatch when HEAD differs from the manifest headSha', async () => {
    const m: BuildManifest = {
      headSha: 'manifest-sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'different-sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('head-sha-mismatch');
  });

  test('served-owner-not-app when a src/server.ts shadow owns the port', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/path/to/src/server.ts', owner: 'shadow' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('served-owner-not-app');
  });

  test('ui-bundle-mismatch when the served index bundle differs from the manifest', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-def456.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('ui-bundle-mismatch');
  });

  test('asar-hash-mismatch when the on-disk asar hash differs from the manifest', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar-manifest',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar-different',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('asar-hash-mismatch');
  });

  test('asar-hash-mismatch when hashAsar returns null', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => null,
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('asar-hash-mismatch');
  });

  test('main-build-sha-mismatch when main ping reports a different build sha', async () => {
    const m: BuildManifest = {
      headSha: 'manifest-sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'manifest-sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      mainPing: () => Promise.resolve({ buildSha: 'different-sha' }),
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('main-build-sha-mismatch');
  });

  test('manifest-missing when no build-manifest.json is present', async () => {
    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('manifest-missing');
  });

  test('manifest-missing skips manifest-derived checks but still runs served-owner check', async () => {
    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      health: () => Promise.resolve({ exePath: '/path/to/src/server.ts', owner: 'shadow' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('manifest-missing');
    expect(result.mismatches).toContain('served-owner-not-app');
    // Manifest-derived checks should not appear.
    expect(result.mismatches).not.toContain('head-sha-mismatch');
    expect(result.mismatches).not.toContain('ui-bundle-mismatch');
    expect(result.mismatches).not.toContain('asar-hash-mismatch');
  });
});

describe('verifyDeployedBuild — ok:true and control channel edge cases', () => {
  const baseResPath = mkdtempSync(join(tmpdir(), 'res-'));

  afterEach(() => {
    rmSync(baseResPath, { recursive: true, force: true });
  });

  test('ok true with an empty mismatch list when every check matches', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(true);
    expect(result.mismatches.length).toBe(0);
  });

  test('absent control channel contributes no main mismatch and never masks the other checks', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    // mainPing is undefined, so it contributes nothing.
    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
      // mainPing is undefined
    });

    expect(result.ok).toBe(true);
    expect(result.mismatches).not.toContain('main-build-sha-mismatch');
  });

  test('mainPing present but resolves null contributes no mismatch', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      mainPing: () => Promise.resolve(null),
      appPath: '/app',
    });

    expect(result.ok).toBe(true);
    expect(result.mismatches).not.toContain('main-build-sha-mismatch');
  });

  test('mainPing present but no buildSha field contributes no mismatch', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => 'sha',
      readManifest: () => m,
      health: () => Promise.resolve({ exePath: '/app/Contents/MacOS/server', owner: 'app' }),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      mainPing: () => Promise.resolve({}), // no buildSha
      appPath: '/app',
    });

    expect(result.ok).toBe(true);
    expect(result.mismatches).not.toContain('main-build-sha-mismatch');
  });

  test('fail CLOSED: throwing deps contribute their mismatch code', async () => {
    const m: BuildManifest = {
      headSha: 'sha',
      asarSha256: 'asar',
      sidecarSha256: 'sidecar',
      uiBundle: 'index-abc123.js',
      builtAt: 1000,
    };
    writeBuildManifest(baseResPath, m);

    const result = await verifyDeployedBuild({
      resourcesPath: baseResPath,
      expectedHeadSha: () => {
        throw new Error('git error');
      },
      readManifest: () => m,
      health: () => Promise.reject(new Error('health error')),
      servedIndexHtml: () => Promise.resolve('<script src="index-abc123.js"></script>'),
      hashAsar: () => 'asar',
      appPath: '/app',
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('head-sha-mismatch');
    expect(result.mismatches).toContain('served-owner-not-app');
  });
});

describe('writeDeployVerification → readSelfDeployStatus round-trip', () => {
  test('round-trips verification fields through readSelfDeployStatus', () => {
    writeDeployVerification({
      ok: true,
      mode: 'hot-swap',
      headSha: 'abc123',
      buildVerified: true,
      mismatches: [],
      message: 'build verified',
    });

    const read = readSelfDeployStatus();
    expect(read).not.toBeNull();
    expect(read!.ok).toBe(true);
    expect(read!.mode).toBe('hot-swap');
    expect(read!.headSha).toBe('abc123');
    expect(read!.buildVerified).toBe(true);
    expect(read!.mismatches).toEqual([]);
    expect(read!.message).toBe('build verified');
    // phase and ts are synthesized when no prior status.
    expect(read!.phase).toBe('done');
    expect(typeof read!.ts).toBe('number');
  });

  test('preserves shell-written fields from prior status', () => {
    const priorLogDir = deployLogDir();
    mkdirSync(priorLogDir, { recursive: true });
    const priorPath = deployStatusPath();
    writeFileSync(
      priorPath,
      JSON.stringify({
        phase: 'done',
        ok: false,
        mode: 'full',
        servedPid: 42,
        escalated: true,
        shadow: false,
        ts: 1000,
        pid: 100,
      }),
    );

    // Now write verification data.
    writeDeployVerification({
      ok: true,
      headSha: 'new-sha',
      buildVerified: true,
      mismatches: [],
    });

    const read = readSelfDeployStatus();
    expect(read).not.toBeNull();
    // Verification fields updated.
    expect(read!.ok).toBe(true);
    expect(read!.headSha).toBe('new-sha');
    expect(read!.buildVerified).toBe(true);
    // Shell-written fields preserved.
    expect(read!.phase).toBe('done');
    expect(read!.mode).toBe('full');
    expect(read!.servedPid).toBe(42);
    expect(read!.escalated).toBe(true);
    expect(read!.shadow).toBe(false);
    expect(read!.ts).toBe(1000);
    expect(read!.pid).toBe(100);
  });

  test('synthesizes a base status when none exists', () => {
    writeDeployVerification({
      ok: true,
      buildVerified: true,
      mismatches: [],
    });

    const read = readSelfDeployStatus();
    expect(read).not.toBeNull();
    expect(read!.phase).toBe('done');
    expect(read!.ok).toBe(true);
    expect(typeof read!.ts).toBe('number');
  });
});
