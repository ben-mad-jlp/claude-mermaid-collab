/**
 * P2: WslTmuxSessionMux argv wrapping + Windows↔WSL path translation.
 * These assert the exact argv shape that was validated live against tmux-in-WSL
 * (doc winport-wsl-validation-2026-06-15).
 */
import { describe, it, expect } from 'bun:test';
import { WslTmuxSessionMux } from '../WslTmuxSessionMux.ts';
import { winToWslPath } from '../wsl-path.ts';
import {
  argvHasSession,
  argvNewSession,
  argvCapturePane,
  argvPsComm,
} from '../tmux-argv.ts';

describe('winToWslPath', () => {
  it('translates Windows absolute paths to /mnt/<drive>', () => {
    expect(winToWslPath('C:\\Users\\ben\\proj')).toBe('/mnt/c/Users/ben/proj');
    expect(winToWslPath('D:/data/repo')).toBe('/mnt/d/data/repo');
    expect(winToWslPath('c:\\x')).toBe('/mnt/c/x');
  });

  it('leaves non-path tokens untouched', () => {
    expect(winToWslPath('tmux')).toBe('tmux');
    expect(winToWslPath('has-session')).toBe('has-session');
    expect(winToWslPath('-t')).toBe('-t');
    expect(winToWslPath('mc-repo-lane')).toBe('mc-repo-lane');
    expect(winToWslPath('#{pane_pid}')).toBe('#{pane_pid}');
    expect(winToWslPath('/already/posix')).toBe('/already/posix');
  });
});

describe('WslTmuxSessionMux.cmd', () => {
  const mux = new WslTmuxSessionMux('Ubuntu-24.04');

  it('prefixes wsl.exe -d <distro> -- and passes tmux verbs through verbatim', () => {
    expect(mux.cmd(argvHasSession('mc-repo-lane'))).toEqual([
      'wsl.exe', '-d', 'Ubuntu-24.04', '--', 'tmux', 'has-session', '-t', 'mc-repo-lane',
    ]);
  });

  it('translates the -c <cwd> path on new-session', () => {
    expect(mux.cmd(argvNewSession('mc-repo-lane', 'C:\\repo\\app'))).toEqual([
      'wsl.exe', '-d', 'Ubuntu-24.04', '--', 'tmux', 'new-session', '-d', '-s', 'mc-repo-lane', '-c', '/mnt/c/repo/app',
    ]);
  });

  it('wraps capture-pane unchanged (no path args)', () => {
    expect(mux.cmd(argvCapturePane('mc-repo-lane'))).toEqual([
      'wsl.exe', '-d', 'Ubuntu-24.04', '--', 'tmux', 'capture-pane', '-t', 'mc-repo-lane', '-p',
    ]);
  });

  it('dispatches the ps snapshot through wsl too (must be the WSL process tree)', () => {
    expect(mux.cmd(argvPsComm())).toEqual([
      'wsl.exe', '-d', 'Ubuntu-24.04', '--', 'ps', '-axo', 'pid=,ppid=,comm=',
    ]);
  });
});
