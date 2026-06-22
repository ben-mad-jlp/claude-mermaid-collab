/**
 * Golden-argv parity: every builder must produce the EXACT literal argv it
 * replaced at its call-site, and the native `mux.cmd` must be the identity. These
 * literals are copied verbatim from the pre-refactor call-sites — if a builder
 * ever drifts, this fails before the change can reach the live worker spine.
 */
import { describe, it, expect } from 'bun:test';
import {
  argvHasSession,
  argvNewSession,
  argvKillSession,
  argvCapturePane,
  argvListPanesPanePid,
  argvDisplayStartPath,
  argvSendKeysLiteral,
  argvSendKeysEnter,
  argvSendKeysNames,
  argvListSessions,
  argvLs,
  argvAttachSession,
  argvVersion,
  argvPsComm,
  argvPsUidComm,
} from '../tmux-argv.ts';
import { mux } from '../index.ts';

describe('tmux-argv golden parity', () => {
  it('has-session', () => {
    expect(argvHasSession('mc-repo-lane')).toEqual(['tmux', 'has-session', '-t', 'mc-repo-lane']);
  });

  it('new-session with and without cwd', () => {
    expect(argvNewSession('mc-repo-lane', '/proj')).toEqual(['tmux', 'new-session', '-d', '-s', 'mc-repo-lane', '-c', '/proj']);
    expect(argvNewSession('mc-repo-lane')).toEqual(['tmux', 'new-session', '-d', '-s', 'mc-repo-lane']);
  });

  it('kill-session', () => {
    expect(argvKillSession('mc-repo-lane')).toEqual(['tmux', 'kill-session', '-t', 'mc-repo-lane']);
  });

  it('capture-pane with and without scrollback', () => {
    expect(argvCapturePane('mc-repo-lane')).toEqual(['tmux', 'capture-pane', '-t', 'mc-repo-lane', '-p']);
    expect(argvCapturePane('mc-repo-lane', 10000)).toEqual(['tmux', 'capture-pane', '-t', 'mc-repo-lane', '-p', '-S', '-10000']);
  });

  it('list-panes pane_pid', () => {
    expect(argvListPanesPanePid('mc-repo-lane')).toEqual(['tmux', 'list-panes', '-t', 'mc-repo-lane', '-F', '#{pane_pid}']);
  });

  it('display-message pane_start_path', () => {
    expect(argvDisplayStartPath('mc-repo-lane')).toEqual(['tmux', 'display-message', '-p', '-t', 'mc-repo-lane', '#{pane_start_path}']);
  });

  it('send-keys literal + Enter (the load-bearing split)', () => {
    expect(argvSendKeysLiteral('mc-repo-lane', '/collab x')).toEqual(['tmux', 'send-keys', '-t', 'mc-repo-lane', '-l', '/collab x']);
    expect(argvSendKeysEnter('mc-repo-lane')).toEqual(['tmux', 'send-keys', '-t', 'mc-repo-lane', 'Enter']);
  });

  it('send-keys key-names (multi-select submit drive)', () => {
    expect(argvSendKeysNames('mc-repo-lane', ['Right'])).toEqual(['tmux', 'send-keys', '-t', 'mc-repo-lane', 'Right']);
    expect(argvSendKeysNames('mc-repo-lane', ['Right', 'Enter'])).toEqual(['tmux', 'send-keys', '-t', 'mc-repo-lane', 'Right', 'Enter']);
  });

  it('list-sessions / ls with format', () => {
    expect(argvListSessions('#{session_name}\t#{session_created}')).toEqual(['tmux', 'list-sessions', '-F', '#{session_name}\t#{session_created}']);
    expect(argvLs('#{session_name}')).toEqual(['tmux', 'ls', '-F', '#{session_name}']);
  });

  it('attach-session', () => {
    expect(argvAttachSession('mc-repo-lane')).toEqual(['tmux', 'attach-session', '-d', '-t', 'mc-repo-lane']);
  });

  it('version probe', () => {
    expect(argvVersion()).toEqual(['tmux', '-V']);
  });

  it('ps snapshots (comm / uid+comm)', () => {
    expect(argvPsComm()).toEqual(['ps', '-axo', 'pid=,ppid=,comm=']);
    expect(argvPsUidComm()).toEqual(['ps', '-axo', 'pid=,ppid=,uid=,comm=']);
  });

  it('native mux.cmd is the identity (byte-parity)', () => {
    const argv = argvNewSession('mc-repo-lane', '/proj');
    expect(mux.cmd(argv)).toEqual(['tmux', 'new-session', '-d', '-s', 'mc-repo-lane', '-c', '/proj']);
    // identity: same contents (a fresh equal array is fine; not required to be the same ref)
    expect(mux.cmd(['ps', '-axo', 'pid=,ppid=,comm='])).toEqual(['ps', '-axo', 'pid=,ppid=,comm=']);
  });
});
