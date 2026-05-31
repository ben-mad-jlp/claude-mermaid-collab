import { describe, it, expect, vi } from 'vitest';
import { resolveLoginPath } from '../server-supervisor';

const HOME = '/Users/tester';

describe('resolveLoginPath', () => {
  it('is a no-op on win32 (GUI inherits a full PATH there)', () => {
    const current = 'C:\\Windows\\system32';
    expect(resolveLoginPath({ platform: 'win32', currentPath: current })).toBe(current);
  });

  it('extracts the login-shell PATH bracketed by the sentinel and merges common dirs', () => {
    const exec = vi.fn((_cmd, _args, _opts) =>
      '__MC_LOGIN_PATH__/opt/homebrew/bin:/usr/bin:/bin__MC_LOGIN_PATH__',
    );
    const out = resolveLoginPath({
      platform: 'darwin',
      currentPath: '/usr/bin:/bin',
      homeDir: HOME,
      shell: '/bin/zsh',
      execImpl: exec as any,
    });
    expect(exec).toHaveBeenCalledWith('/bin/zsh', ['-ilc', expect.stringContaining('$PATH')], expect.anything());
    // Resolved login PATH is kept, with missing common dirs prepended (deduped).
    const dirs = out.split(':');
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin'); // added as backstop, wasn't in login PATH
    expect(dirs.indexOf('/usr/local/bin')).toBeLessThan(dirs.indexOf('/opt/homebrew/bin'));
    // No duplicate of the dir the login shell already had.
    expect(dirs.filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1);
  });

  it('ignores rc-file chatter outside the sentinels', () => {
    const exec = vi.fn(() => 'Welcome motd line\n__MC_LOGIN_PATH__/opt/homebrew/bin__MC_LOGIN_PATH__\ntrailing');
    const out = resolveLoginPath({ platform: 'darwin', currentPath: '/bin', homeDir: HOME, execImpl: exec as any });
    expect(out.split(':')).toContain('/opt/homebrew/bin');
    expect(out).not.toContain('motd');
  });

  it('falls back to prepending common dirs to the current PATH when the shell fails', () => {
    const exec = vi.fn(() => {
      throw new Error('shell timed out');
    });
    const out = resolveLoginPath({ platform: 'darwin', currentPath: '/usr/bin:/bin', homeDir: HOME, execImpl: exec as any });
    const dirs = out.split(':');
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
    expect(dirs).toContain(`${HOME}/.bun/bin`);
    // Original entries preserved at the tail.
    expect(dirs).toContain('/usr/bin');
    expect(dirs).toContain('/bin');
  });

  it('falls back when the shell output has no sentinel', () => {
    const exec = vi.fn(() => 'garbage with no markers');
    const out = resolveLoginPath({ platform: 'darwin', currentPath: '/usr/bin', homeDir: HOME, execImpl: exec as any });
    expect(out.split(':')).toContain('/opt/homebrew/bin');
  });
});
