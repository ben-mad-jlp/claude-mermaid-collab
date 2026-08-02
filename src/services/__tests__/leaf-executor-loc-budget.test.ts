import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as leafExecutor from '../leaf-executor';
import { locRatchetVerdict } from '../loc-ratchet';

describe('leaf-executor LOC budget', () => {
  // This is a down-only ratchet that compares the current leaf-executor.ts line count
  // against the line count at the branch's merge-base (typically master). Growth without
  // justification always fails; the ceiling can never be raised in the growth diff itself.
  // See loc-ratchet.ts for the pure comparator.
  it('leaf-executor.ts must not grow past its branch base line count', () => {
    const leafExecutorPath = path.join(__dirname, '../leaf-executor.ts');
    const repoRoot = path.join(__dirname, '../../../');

    let baseSha: string;
    try {
      baseSha = execFileSync('git', ['merge-base', 'HEAD', 'master'], {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();
    } catch (err) {
      // Detached HEAD, shallow clone, non-git fixture, or other git resolution failure
      console.log('Skipping LOC ratchet test: unable to resolve merge-base (detached HEAD, shallow clone, or non-git fixture)');
      return; // Skip this test
    }

    let baseContent: string;
    try {
      baseContent = execFileSync('git', ['show', `${baseSha}:src/services/leaf-executor.ts`], {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
    } catch (err) {
      // File doesn't exist at base or other git show error
      console.log('Skipping LOC ratchet test: unable to read file at merge-base');
      return; // Skip this test
    }

    const baseLOC = baseContent.split('\n').length;
    const currentContent = fs.readFileSync(leafExecutorPath, 'utf-8');
    const currentLOC = currentContent.split('\n').length;

    const verdict = locRatchetVerdict({ current: currentLOC, base: baseLOC });
    expect(verdict.ok, verdict.reason).toBe(true);
  });

  it('should re-export all required functions', () => {
    expect(typeof leafExecutor.buildNodePrompt).toBe('function');
    expect(typeof leafExecutor.buildReviewPrompt).toBe('function');
    expect(typeof leafExecutor.buildVerifyPrompt).toBe('function');
    expect(typeof leafExecutor.parseVerdict).toBe('function');
    expect(typeof leafExecutor.parseVerifyGate).toBe('function');
    expect(typeof leafExecutor.parseSizeManifest).toBe('function');
    expect(typeof leafExecutor.joinReviewReports).toBe('function');
    expect(typeof leafExecutor.isCacheableBaseGateStatus).toBe('function');
    expect(typeof leafExecutor.resolveBaseGreen).toBe('function');
    expect(typeof leafExecutor.escalateLegacyGateResidual).toBe('function');
    expect(typeof leafExecutor.formatGateErrorReason).toBe('function');
  });
});
