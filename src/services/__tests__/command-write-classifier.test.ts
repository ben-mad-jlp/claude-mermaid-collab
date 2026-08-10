/**
 * Regression tests for command-write-classifier.ts and detectOutsideWorktreeWrite.
 *
 * Tables test that the classifier correctly:
 * - Treats READ-only commands as contributing no write targets
 * - Resolves relative write targets against the current cwd
 * - Tracks cwd changes from `cd` commands
 * - Collects redirect targets (>, >>)
 * - Ignores false-positive patterns like compound commands with a read-only leg
 */
import { describe, it, expect } from 'bun:test';
import { detectOutsideWorktreeWrite, type RecordedCommand } from '../node-commands';

const WT = '/home/ben/code/qbs/.collab/agent-sessions/worktrees/leaf-exec-df08b5e3';
const cmd = (c: string, cwd = WT): RecordedCommand => ({ cmd: c, cwd, exitCode: 0 });

describe('detectOutsideWorktreeWrite via classifyCommandWrites', () => {
  it('does NOT flag a READ verb (find) even when it names an absolute path', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('find /home/other/service -name x')],
    });
    expect(found).toBeNull();
  });

  it('does NOT flag a WRITE verb whose argument resolves inside the worktree', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('mkdir -p rel/dir')],
    });
    expect(found).toBeNull();
  });

  it('detectOutsideWorktreeWrite treats a compound mkdir;find with a read-only find leg as null (4f05dc2a)', () => {
    // The find segment is READ-only and should not contribute any targets,
    // even though it names an absolute path.
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [
        cmd('mkdir -p .collab/leaf-blueprints; find /home/other/service -maxdepth 2 -iname leaf-blueprints'),
      ],
    });
    expect(found).toBeNull();
  });

  it('catches a WRITE verb whose argument resolves outside the worktree', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('mkdir -p /home/other/service/dir')],
    });
    expect(found).not.toBeNull();
    expect(found!.paths.join(' ')).toContain('/home/other/service/dir');
  });

  it('detectOutsideWorktreeWrite catches a relative redirect resolved against a post-cd cwd outside the worktree', () => {
    // This is the adapted test row from the blueprint: cd to /home/other/service,
    // then write to a relative path outside both WT and WRITE_ALLOWED_PREFIXES.
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('cd /home/other/service && cat > vac/x.ts')],
    });
    expect(found).not.toBeNull();
    expect(found!.paths.join(' ')).toContain('/home/other/service/vac/x.ts');
  });
});

describe('detectOutsideWorktreeWrite regression suite', () => {
  // Re-run the existing cases from privilege-escalation.test.ts to ensure
  // the rewired classifier produces the same results.

  it('catches the verbatim cp into the service runtime path', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd(`cp -a ${WT}/src/. /home/qbintelligence/code/qbs/ros-api-server/src/`)],
    });
    expect(found).not.toBeNull();
    expect(found!.paths.join(' ')).toContain('/home/qbintelligence/code/qbs/ros-api-server/src');
    expect(found!.message).toContain('bypasses all three');
  });

  it('catches the chown that made the copied files look native', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('chown -R qbintelligence:qbintelligence /home/qbintelligence/code/qbs/ros-api-server/src')],
    });
    expect(found).not.toBeNull();
  });

  it('catches an absolute redirect outside the worktree', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('echo poisoned > /etc/systemd/system/ros-api.service')],
    });
    expect(found).not.toBeNull();
  });

  it('closes the gap detectWorkingRootEscape leaves: cwd INSIDE, target absolute', () => {
    // The incident's cp ran with cwd inside the worktree, so the cwd-escape
    // detector saw nothing. This is precisely that shape.
    const c = cmd(`cp -a ${WT}/package.json /home/qbintelligence/code/qbs/ros-api-server/package.json`);
    expect(c.cwd).toBe(WT); // cwd never left
    expect(detectOutsideWorktreeWrite({ worktreeRoot: WT, commands: [c] })).not.toBeNull();
  });

  it('allows scratch space and in-worktree writes', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [
        cmd('npm test > /tmp/evidence-npm-test.txt 2>&1'),
        cmd('echo hi > /dev/null'),
        cmd(`cp -a ${WT}/src/a.js ${WT}/src/b.js`),
        cmd('mkdir -p .collab/leaf-blueprints'),
      ],
    });
    expect(found).toBeNull();
  });

  it('does NOT flag read-only reads of outside paths', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd('cat /home/qbintelligence/code/qbs/ros-api-server/src/health.js')],
    });
    expect(found).toBeNull();
  });

  it('never throws — fails open on an unresolvable root', () => {
    expect(() =>
      detectOutsideWorktreeWrite({ worktreeRoot: '/nonexistent/root', commands: [cmd('cp a /etc/x')] }),
    ).not.toThrow();
  });
});
