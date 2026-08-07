/**
 * Regression: the residue guard must compare porcelain entries by PATH, not by the whole line.
 *
 * `git status --porcelain` prefixes every entry with a 2-char status field, so the SAME file
 * yields a DIFFERENT string depending on whether its change is staged:
 *
 *   " M src/x.ts"   unstaged
 *   "M  src/x.ts"   staged
 *
 * The guard snapshotted before/after and diffed the raw strings, so a file that merely moved
 * between those two states read as newly-introduced residue.
 *
 * land_epic's tree/index restore re-stages whatever it finds dirty, so EVERY pre-existing
 * dirty file flips " M" -> "M " across a land. On 2026-08-07 a land that had already merged
 * — master advanced to 7e1ff0cf, the fix present on master, gate verdict PASS — was then
 * reported FAILED, naming four files that were dirty before it started and had been waved
 * through with allowDirty. Reporting failure for a completed irreversible merge is the worst
 * available answer: it invites a retry of something that already happened.
 */
import { describe, test, expect } from 'bun:test';
import {
  residuePath,
  withMainCheckoutInvariant,
  MainCheckoutResidueError,
  type GitRunner,
} from '../main-checkout-invariant';

/** A runner that answers the three probes readMainCheckoutHead makes, twice (before/after). */
function runnerFor(beforeStatus: string, afterStatus: string): GitRunner {
  const queue = [
    { code: 0, stdout: 'master\n', stderr: '' },
    { code: 0, stdout: 'abc123\n', stderr: '' },
    { code: 0, stdout: beforeStatus, stderr: '' },
    { code: 0, stdout: 'master\n', stderr: '' },
    { code: 0, stdout: 'abc123\n', stderr: '' },
    { code: 0, stdout: afterStatus, stderr: '' },
  ];
  let i = 0;
  return async () => queue[i++] ?? { code: 1, stdout: '', stderr: 'exhausted' };
}

describe('residuePath', () => {
  test('strips the status prefix in both staged and unstaged forms', () => {
    expect(residuePath(' M src/x.ts')).toBe('src/x.ts');
    expect(residuePath('M  src/x.ts')).toBe('src/x.ts');
    expect(residuePath('MM src/x.ts')).toBe('src/x.ts');
    expect(residuePath('?? src/x.ts')).toBe('src/x.ts');
    // Entries arrive pre-trimmed, so the leading space may already be gone.
    expect(residuePath('M src/x.ts')).toBe('src/x.ts');
  });

  test('a rename reduces to its destination', () => {
    expect(residuePath('R  src/old.ts -> src/new.ts')).toBe('src/new.ts');
  });

  test('the staged and unstaged forms of one file agree', () => {
    expect(residuePath(' M src/x.ts')).toBe(residuePath('M  src/x.ts'));
  });
});

describe('withMainCheckoutInvariant residue comparison', () => {
  test('a pre-existing dirty file that becomes STAGED is not "introduced"', async () => {
    // The incident, reduced: dirty before, re-staged by the operation, same file throughout.
    const runGit = runnerFor(' M src/services/epic-land-gate.ts\n', 'M  src/services/epic-land-gate.ts\n');
    const result = await withMainCheckoutInvariant('/repo', runGit, async () => 'landed', { opName: 'land_epic' });
    expect(result).toBe('landed');
  });

  test('a genuinely NEW file still throws — the guard must keep working', async () => {
    const runGit = runnerFor(' M src/a.ts\n', ' M src/a.ts\n M src/b.ts\n');
    await expect(
      withMainCheckoutInvariant('/repo', runGit, async () => 'x', { opName: 'land_epic' }),
    ).rejects.toBeInstanceOf(MainCheckoutResidueError);
  });

  test('the reported residue names only the genuinely new path', async () => {
    const runGit = runnerFor(' M src/a.ts\n', 'M  src/a.ts\n M src/b.ts\n');
    let caught: MainCheckoutResidueError | null = null;
    try {
      await withMainCheckoutInvariant('/repo', runGit, async () => 'x', { opName: 'land_epic' });
    } catch (e) { caught = e as MainCheckoutResidueError; }
    expect(caught).toBeInstanceOf(MainCheckoutResidueError);
    // src/a.ts merely re-staged — must NOT be listed; only src/b.ts is new.
    expect(caught!.addedResidue.join(' ')).toContain('src/b.ts');
    expect(caught!.addedResidue.join(' ')).not.toContain('src/a.ts');
  });

  test('a clean checkout that stays clean passes', async () => {
    const runGit = runnerFor('', '');
    expect(await withMainCheckoutInvariant('/repo', runGit, async () => 'ok')).toBe('ok');
  });
});
