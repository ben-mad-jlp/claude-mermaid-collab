import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyProbeIO } from '../../../scripts/verify-deployed-build';
import { runVerifyDeployedBuild } from '../../../scripts/verify-deployed-build';
import { readSelfDeployStatus, deployLogDir, deployStatusPath } from '../deploy-service';
import { _closeAllCollabDbs } from '../collab-db';

let logDir: string;

beforeEach(() => {
  logDir = mkdtempSync(join(tmpdir(), 'deploy-logs-'));
  process.env.MERMAID_DEPLOY_LOG_DIR = logDir;
});

afterEach(() => {
  _closeAllCollabDbs();
  delete process.env.MERMAID_DEPLOY_LOG_DIR;
  rmSync(logDir, { recursive: true, force: true });
});

describe('runVerifyDeployedBuild', () => {
  test('returns 0 and records buildVerified true when the deployed build matches HEAD', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        const prior = readSelfDeployStatus();
        const merged = {
          phase: prior?.phase ?? 'done',
          ok: status.ok ?? prior?.ok ?? null,
          ts: prior?.ts ?? Date.now(),
          mode: status.mode ?? prior?.mode,
          servedPid: prior?.servedPid,
          escalated: prior?.escalated,
          shadow: prior?.shadow,
          pid: prior?.pid,
          headSha: status.headSha,
          buildVerified: status.buildVerified,
          mismatches: status.mismatches,
          message: status.message,
        };
        writeFileSync(deployStatusPath(), JSON.stringify(merged));
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123def456',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Electron',
          owner: 'collab',
        }),
        servedIndexHtml: async () =>
          '<html><script src="index-abc123.js"></script></html>',
        hashAsar: () => 'asar-sha256-hash',
        readManifest: () => ({
          headSha: 'abc123def456',
          asarSha256: 'asar-sha256-hash',
          sidecarSha256: 'sidecar-sha256-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
        mainPing: async () => ({
          buildSha: 'abc123def456', // must match manifest.headSha
        }),
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(0);
    const status = readSelfDeployStatus();
    expect(status?.ok).toBe(true);
    expect(status?.buildVerified).toBe(true);
    expect(status?.mismatches).toEqual([]);
  });

  test('returns non-zero and readSelfDeployStatus reports ok false with the mismatch codes', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        const prior = readSelfDeployStatus();
        const merged = {
          phase: prior?.phase ?? 'done',
          ok: status.ok ?? prior?.ok ?? null,
          ts: prior?.ts ?? Date.now(),
          mode: status.mode ?? prior?.mode,
          servedPid: prior?.servedPid,
          escalated: prior?.escalated,
          shadow: prior?.shadow,
          pid: prior?.pid,
          headSha: status.headSha,
          buildVerified: status.buildVerified,
          mismatches: status.mismatches,
          message: status.message,
        };
        writeFileSync(deployStatusPath(), JSON.stringify(merged));
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123def456',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Electron',
          owner: 'collab',
        }),
        servedIndexHtml: async () =>
          '<html><script src="index-def456.js"></script></html>',
        hashAsar: () => 'wrong-asar-hash',
        readManifest: () => ({
          headSha: 'abc123def456',
          asarSha256: 'correct-asar-hash',
          sidecarSha256: 'sidecar-sha256-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
        mainPing: async () => ({
          buildSha: 'sidecar-sha256-hash',
        }),
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(1);
    const status = readSelfDeployStatus();
    expect(status?.ok).toBe(false);
    expect(status?.buildVerified).toBe(false);
    expect(status?.mismatches).toBeDefined();
    expect(status?.mismatches?.length).toBeGreaterThan(0);
    expect(
      status?.mismatches?.some((m) => m === 'ui-bundle-mismatch'),
    ).toBe(true);
    expect(
      status?.mismatches?.some((m) => m === 'asar-hash-mismatch'),
    ).toBe(true);
  });

  test('logs each mismatch with expected/actual pair', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: () => {
        // no-op for this test
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Electron',
          owner: 'collab',
        }),
        servedIndexHtml: async () =>
          '<html><script src="index-wrong.js"></script></html>',
        hashAsar: () => 'wrong-hash',
        readManifest: () => ({
          headSha: 'abc123',
          asarSha256: 'correct-hash',
          sidecarSha256: 'sidecar-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
        mainPing: async () => ({
          buildSha: 'sidecar-hash',
        }),
      },
    };

    await runVerifyDeployedBuild(io);

    const mismatchLogs = logs.filter((l) => l.includes('mismatch'));
    expect(mismatchLogs.length).toBeGreaterThan(0);
    expect(mismatchLogs.some((l) => l.includes('expected='))).toBe(true);
    expect(mismatchLogs.some((l) => l.includes('actual='))).toBe(true);
  });

  test('handles manifest-missing mismatch', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        const prior = readSelfDeployStatus();
        const merged = {
          phase: prior?.phase ?? 'done',
          ok: status.ok ?? prior?.ok ?? null,
          ts: prior?.ts ?? Date.now(),
          mode: status.mode ?? prior?.mode,
          servedPid: prior?.servedPid,
          escalated: prior?.escalated,
          shadow: prior?.shadow,
          pid: prior?.pid,
          headSha: status.headSha,
          buildVerified: status.buildVerified,
          mismatches: status.mismatches,
          message: status.message,
        };
        writeFileSync(deployStatusPath(), JSON.stringify(merged));
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Electron',
        }),
        servedIndexHtml: async () => '<html></html>',
        hashAsar: () => null,
        readManifest: () => null, // manifest missing
        mainPing: undefined,
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(1);
    const status = readSelfDeployStatus();
    expect(status?.mismatches?.includes('manifest-missing')).toBe(true);
  });

  test('handles served-owner-not-app mismatch', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        const prior = readSelfDeployStatus();
        const merged = {
          phase: prior?.phase ?? 'done',
          ok: status.ok ?? prior?.ok ?? null,
          ts: prior?.ts ?? Date.now(),
          mode: status.mode ?? prior?.mode,
          servedPid: prior?.servedPid,
          escalated: prior?.escalated,
          shadow: prior?.shadow,
          pid: prior?.pid,
          headSha: status.headSha,
          buildVerified: status.buildVerified,
          mismatches: status.mismatches,
          message: status.message,
        };
        writeFileSync(deployStatusPath(), JSON.stringify(merged));
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123',
        health: async () => ({
          exePath: '/path/to/src/server.ts', // shadow
        }),
        servedIndexHtml: async () => '<html></html>',
        hashAsar: () => 'asar-hash',
        readManifest: () => ({
          headSha: 'abc123',
          asarSha256: 'asar-hash',
          sidecarSha256: 'sidecar-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(1);
    const status = readSelfDeployStatus();
    expect(status?.mismatches?.includes('served-owner-not-app')).toBe(true);
  });

  test('handles head-sha-mismatch', async () => {
    const logs: string[] = [];
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        const prior = readSelfDeployStatus();
        const merged = {
          phase: prior?.phase ?? 'done',
          ok: status.ok ?? prior?.ok ?? null,
          ts: prior?.ts ?? Date.now(),
          mode: status.mode ?? prior?.mode,
          servedPid: prior?.servedPid,
          escalated: prior?.escalated,
          shadow: prior?.shadow,
          pid: prior?.pid,
          headSha: status.headSha,
          buildVerified: status.buildVerified,
          mismatches: status.mismatches,
          message: status.message,
        };
        writeFileSync(deployStatusPath(), JSON.stringify(merged));
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'current-sha',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Electron',
        }),
        servedIndexHtml: async () =>
          '<html><script src="index-abc123.js"></script></html>',
        hashAsar: () => 'asar-hash',
        readManifest: () => ({
          headSha: 'old-sha', // different!
          asarSha256: 'asar-hash',
          sidecarSha256: 'sidecar-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
        mainPing: async () => ({
          buildSha: 'sidecar-hash',
        }),
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(1);
    const status = readSelfDeployStatus();
    expect(status?.mismatches?.includes('head-sha-mismatch')).toBe(true);
  });

  test('returns 0 and logs an indeterminate line when both bundle sides are unresolved', async () => {
    const logs: string[] = [];
    let capturedPayload: any;
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        capturedPayload = status;
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Mermaid Collab',
          owner: 'collab',
        }),
        servedIndexHtml: async () => '<html></html>',
        hashAsar: () => 'asar-hash',
        readManifest: () => ({
          headSha: 'abc123',
          asarSha256: 'asar-hash',
          sidecarSha256: 'sidecar-hash',
          uiBundle: 'unknown',
          builtAt: 1000,
        }),
        mainPing: undefined,
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(0);
    expect(logs.some((l) => l.startsWith('indeterminate ui-bundle:'))).toBe(true);
    const indeterminateLog = logs.find((l) => l.startsWith('indeterminate ui-bundle:'));
    expect(indeterminateLog).toContain('reason="both-bundles-unresolved"');
    expect(indeterminateLog).toContain('unresolved="both"');
    expect(logs.some((l) => l.startsWith('mismatch ui-bundle-mismatch'))).toBe(false);
    expect(capturedPayload?.ok).toBe(true);
    expect(capturedPayload?.buildVerified).toBe(false);
  });

  test('returns 1 and logs mismatch ui-bundle-mismatch for two distinct resolved bundle hashes', async () => {
    const logs: string[] = [];
    let capturedPayload: any;
    const io: VerifyProbeIO = {
      log: (line: string) => logs.push(line),
      writeVerification: (status) => {
        capturedPayload = status;
      },
      deps: {
        resourcesPath: '/app/Resources',
        appPath: '/app',
        expectedHeadSha: () => 'abc123',
        health: async () => ({
          exePath: '/app/Contents/MacOS/Mermaid Collab',
          owner: 'collab',
        }),
        servedIndexHtml: async () => '<html><script src="index-def456.js"></script></html>',
        hashAsar: () => 'asar-hash',
        readManifest: () => ({
          headSha: 'abc123',
          asarSha256: 'asar-hash',
          sidecarSha256: 'sidecar-hash',
          uiBundle: 'index-abc123.js',
          builtAt: 1000,
        }),
        mainPing: undefined,
      },
    };

    const code = await runVerifyDeployedBuild(io);

    expect(code).toBe(1);
    expect(logs.some((l) => l.startsWith('mismatch ui-bundle-mismatch'))).toBe(true);
  });
});

describe('deploy-desktop.sh step 5 integration', () => {
  test('deploy-desktop.sh step 5 runs verify-deployed-build.ts and dies on its failure', () => {
    const scriptContent = readFileSync(
      join(import.meta.dir, '../../../scripts/deploy-desktop.sh'),
      'utf8',
    );

    // Assert the script invokes verify-deployed-build.ts
    expect(scriptContent).toContain('scripts/verify-deployed-build.ts');

    // Assert the probe invocation is captured with set +e for error handling
    expect(scriptContent).toContain('set +e');
    expect(scriptContent).toContain('VERIFY_OUT=');
    expect(scriptContent).toContain('VERIFY_RC=');

    // Assert the non-zero exit path calls write_status false and die
    expect(scriptContent).toContain('if [ "$VERIFY_RC" != 0 ]');
    expect(scriptContent).toContain('die "build verification failed');

    // Assert the --no-verify flag case arm exists
    expect(scriptContent).toContain('--no-verify) DO_VERIFY=0 ;;');

    // Assert the DO_VERIFY initialization exists
    expect(scriptContent).toContain('DO_VERIFY=1');

    // Assert the --no-verify branch logs it was skipped
    expect(scriptContent).toContain(
      'log "verification skipped (--no-verify)"',
    );

    // Assert the success path still calls write_status with true
    expect(scriptContent).toContain(
      'write_status true "$MODE" "$SIDECAR_PID" false "$UI_OK"',
    );
  });

  test('deploy-desktop.sh no longer has the soft WARNING message', () => {
    const scriptContent = readFileSync(
      join(import.meta.dir, '../../../scripts/deploy-desktop.sh'),
      'utf8',
    );

    // The old soft warning should be gone
    expect(scriptContent).not.toContain(
      'WARNING: served bundle',
    );
  });
});
