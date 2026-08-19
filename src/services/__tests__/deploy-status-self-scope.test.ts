import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deployStaleness } from '../deploy-service.ts';

describe('deployStaleness', () => {
  it('a non-self project returns stale false with repoVersion null', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'deploy-status-test-'));
    try {
      // Create a temp package.json with a name that's NOT 'claude-mermaid-collab'
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'some-other-project' })
      );

      const result = deployStaleness({
        project: tempDir,
        repoVersion: null,
        versionDrift: true,
        selfLandPending: false,
        modifiedTrackedCount: 3,
      });

      expect(result.stale).toBe(false);
      expect(result.notSelfProject).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  });

  it('the self project with version drift still returns stale true', () => {
    // Resolve the real repo root from import.meta.dir
    // src/services/__tests__ → three levels up to repo root
    const repoRoot = join(
      import.meta.dir,
      '..',
      '..',
      '..'
    );

    const result = deployStaleness({
      project: repoRoot,
      repoVersion: '5.19.0',
      versionDrift: true,
      selfLandPending: false,
      modifiedTrackedCount: 0,
    });

    expect(result.stale).toBe(true);
    expect(result.notSelfProject).toBe(false);
  });
});
