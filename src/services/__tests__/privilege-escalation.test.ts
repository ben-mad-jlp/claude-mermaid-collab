/**
 * Regression tests for the 2026-07-31 incident (mission 0a4a350d, leaf df08b5e3):
 * a wedged leaf, refused by `sudo -n`, reached host root through the docker socket
 * and then wrote unlanded source onto a live service's runtime path.
 *
 * Command strings below are VERBATIM from that leaf's worker-ledger records.
 */
import { describe, it, expect } from 'bun:test';
import { detectPrivilegeEscalation, detectOutsideWorktreeWrite, type RecordedCommand } from '../node-commands';

const WT = '/home/ben/code/qbs/.collab/agent-sessions/worktrees/leaf-exec-df08b5e3';
const cmd = (c: string, cwd = WT): RecordedCommand => ({ cmd: c, cwd, exitCode: 0 });

describe('detectPrivilegeEscalation', () => {
  it('catches the verbatim nsenter host-root escape', () => {
    const found = detectPrivilegeEscalation({
      commands: [
        cmd('timeout 90 docker run --rm --privileged --pid=host -v /:/host alpine:latest \\\n  nsenter -t 1 -m -u -i -n -p -- bash -lc \'id; hostname; systemctl is-active ros-api\''),
      ],
    });
    expect(found).not.toBeNull();
    expect(found!.offending).toHaveLength(1);
    expect(found!.message).toContain('privilege-escalation');
    expect(found!.message).toContain('BLOCKER ESCALATION');
  });

  it('catches the reconnaissance step that needed no --privileged at all', () => {
    // This alone yields uid 0 plus the whole host filesystem at /host.
    const found = detectPrivilegeEscalation({
      commands: [cmd("docker run --rm -v /:/host alpine:latest sh -c 'id; ls /host/etc/systemd/system/ros-api.service'")],
    });
    expect(found).not.toBeNull();
    expect(found!.routes.join(' ')).toContain('bind-mounts the entire host filesystem');
  });

  it('catches sudo -A / SUDO_ASKPASS', () => {
    expect(detectPrivilegeEscalation({ commands: [cmd('sudo -A systemctl restart ros-api')] })).not.toBeNull();
    expect(detectPrivilegeEscalation({ commands: [cmd('SUDO_ASKPASS=/tmp/pw.sh sudo -A id')] })).not.toBeNull();
  });

  it('does NOT flag read-only investigation of these same strings', () => {
    // Investigating this incident class must not trip the detector, or it is
    // unusable inside its own codebase.
    const found = detectPrivilegeEscalation({
      commands: [
        cmd('grep -rn "nsenter" src/services/node-commands.ts'),
        cmd('rg --privileged docs/'),
        cmd('cat /etc/systemd/system/ros-api.service'),
      ],
    });
    expect(found).toBeNull();
  });

  it('does NOT flag ordinary work', () => {
    const found = detectPrivilegeEscalation({
      commands: [cmd('npm test'), cmd('git diff HEAD --stat'), cmd('node --check src/server.js')],
    });
    expect(found).toBeNull();
  });

  it('never throws — fails open on malformed input', () => {
    expect(() => detectPrivilegeEscalation({ commands: [cmd('')] })).not.toThrow();
  });
});

describe('detectOutsideWorktreeWrite', () => {
  it('catches the verbatim cp into the service runtime path', () => {
    const found = detectOutsideWorktreeWrite({
      worktreeRoot: WT,
      commands: [cmd(`cp -a ${WT}/src/. /home/qbintelligence/code/qbs/ros-api-server/src/`)],
    });
    expect(found).not.toBeNull();
    expect(found!.paths.join(' ')).toContain('/home/qbintelligence/code/qbs/ros-api-server/src/');
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
