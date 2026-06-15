/**
 * TmuxSessionMux — the native mac/linux backend (and, when the sidecar runs
 * inside WSL, the Windows backend too). `cmd` is the identity: the argv produced
 * by the `tmux-argv.ts` builders is spawned verbatim, byte-identical to the
 * literals it replaced. This is the proven path; P1 introduces it with ZERO
 * behavior change (golden-argv parity test + the existing tmux/coordinator/fleet
 * /PTYManager suites are the guard).
 *
 * `WslTmuxSessionMux` (P2) extends this and overrides `cmd` to prefix
 * `wsl -d <distro> --` and translate embedded paths — the only methods that need
 * to change, because everything downstream (capture/`ps`-subtree/naming) is the
 * same tmux running inside Linux.
 */
import type { SessionMux } from './SessionMux.ts';
import { isTmuxAvailable } from '../tmux-availability.ts';

export class TmuxSessionMux implements SessionMux {
  /** Native backend: spawn the argv exactly as built. */
  cmd(argv: string[]): string[] {
    return argv;
  }

  available(): Promise<boolean> {
    return isTmuxAvailable();
  }
}
