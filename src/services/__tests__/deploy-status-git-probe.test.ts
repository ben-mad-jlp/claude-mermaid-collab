import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import {
  modifiedTrackedCount,
  GIT_STATUS_PROBE_TTL_MS,
  _resetGitStatusProbeCache,
} from '../git-status-probe.ts';
import { handleSupervisorRoutes } from '../../routes/supervisor-routes.ts';
import { systemStatus } from '../system-status.ts';

describe('deploy-status-git-probe', () => {
  beforeEach(() => {
    _resetGitStatusProbeCache();
  });

  afterEach(() => {
    _resetGitStatusProbeCache();
  });

  // (a) Assert that execFileSync has zero matches in supervisor-routes.ts
  it('supervisor-routes.ts contains zero execFileSync matches', () => {
    const routesPath = path.join(import.meta.dir, '../../routes/supervisor-routes.ts');
    const content = readFileSync(routesPath, 'utf8');
    const execFileSyncMatches = content.match(/execFileSync/g);
    const count = execFileSyncMatches ? execFileSyncMatches.length : 0;
    expect(count).toBe(0);
  });

  // (b) Test TTL caching: spawn once within TTL, re-spawn after TTL expires
  it('caches within TTL (single spawn) and re-spawns after TTL expiry', async () => {
    // Create a temporary git repo with one tracked modified file
    const tempDir = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'git-probe-test-'));
    try {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });

      // Create and commit a file
      const filePath = path.join(tempDir, 'test.txt');
      Bun.write(filePath, 'initial content');
      execSync('git add test.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      // Modify the file (tracked, not untracked)
      Bun.write(filePath, 'modified content');

      // Spy on spawn calls
      let spawnCallCount = 0;
      const spySpawn = (cmd: string[], opts: any) => {
        spawnCallCount++;
        return Bun.spawn(cmd, opts);
      };

      // Time control: start at epoch 1000
      let currentTime = 1000;
      const mockNow = () => currentTime;

      // Call 1: should spawn
      const result1 = await modifiedTrackedCount(tempDir, {
        spawn: spySpawn,
        now: mockNow,
        ttlMs: GIT_STATUS_PROBE_TTL_MS,
      });
      expect(result1).toBe(1); // One modified tracked file
      expect(spawnCallCount).toBe(1);

      // Call 2 immediately (same time): should NOT spawn (cache hit)
      const result2 = await modifiedTrackedCount(tempDir, {
        spawn: spySpawn,
        now: mockNow,
        ttlMs: GIT_STATUS_PROBE_TTL_MS,
      });
      expect(result2).toBe(1);
      expect(spawnCallCount).toBe(1); // Still 1, no additional spawn

      // Call 3 after TTL expires: should spawn again
      currentTime += GIT_STATUS_PROBE_TTL_MS + 1;
      const result3 = await modifiedTrackedCount(tempDir, {
        spawn: spySpawn,
        now: mockNow,
        ttlMs: GIT_STATUS_PROBE_TTL_MS,
      });
      expect(result3).toBe(1);
      expect(spawnCallCount).toBe(2); // Now spawned again
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // (c) Test the deploy-status route returns 200 with correct key set
  it('GET /api/supervisor/deploy-status returns 200 with unchanged response key set', async () => {
    // Create a temporary git repo
    const tempDir = mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'deploy-status-test-'));
    try {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });

      // Create and commit a file to make it a valid git repo
      const filePath = path.join(tempDir, 'test.txt');
      Bun.write(filePath, 'content');
      execSync('git add test.txt', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      // Get system status to extract deploy keys
      const status = await systemStatus(tempDir);
      const deployKeys = Object.keys(status.deploy).sort();

      // Expected additional keys beyond status.deploy
      const expectedExtraKeys = [
        'canDeploy',
        'deployBlockedReason',
        'lastDeploy',
        'lastSelfLandAt',
        'modifiedTrackedCount',
        'selfLandPending',
        'stale',
        'versionDrift',
      ].sort();

      // Make the HTTP request
      const url = new URL(`http://x/api/supervisor/deploy-status?project=${encodeURIComponent(tempDir)}`);
      const req = new Request(url.toString());
      const res = await handleSupervisorRoutes(req, url);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const body = (await res!.json()) as Record<string, unknown>;
      const returnedKeys = Object.keys(body).sort();

      // All deploy keys should be present
      for (const key of deployKeys) {
        expect(returnedKeys).toContain(key);
      }

      // All extra keys should be present
      for (const key of expectedExtraKeys) {
        expect(returnedKeys).toContain(key);
      }

      // The union should match exactly
      const expectedAllKeys = [...new Set([...deployKeys, ...expectedExtraKeys])].sort();
      expect(returnedKeys).toEqual(expectedAllKeys);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
