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
import type { SessionMux, SessionInfo } from './SessionMux.ts';
import { isTmuxAvailable } from '../tmux-availability.ts';
import { argvListSessions } from './tmux-argv.ts';

export class TmuxSessionMux implements SessionMux {
  /** Native backend: spawn the argv exactly as built. */
  cmd(argv: string[]): string[] {
    return argv;
  }

  available(): Promise<boolean> {
    return isTmuxAvailable();
  }

  /** Native backend: the command runs as-is (byte-parity). */
  shellWrap(command: string): string {
    return command;
  }

  /** `tmux list-sessions -F '#{session_name}\t#{session_created}'` → SessionInfo[].
   *  Exits non-zero ("no server running") → []. tmux session_created is epoch
   *  seconds; we normalize to ms. */
  async list(): Promise<SessionInfo[]> {
    try {
      const proc = Bun.spawn(this.cmd(argvListSessions('#{session_name}\t#{session_created}')), {
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const out = await new Response(proc.stdout).text();
      if ((await proc.exited) !== 0) return [];
      const sessions: SessionInfo[] = [];
      for (const line of out.split('\n')) {
        const [name, created] = line.split('\t');
        if (!name) continue;
        const sec = created ? Number(created) : NaN;
        sessions.push({ name, createdAt: Number.isFinite(sec) ? sec * 1000 : null });
      }
      return sessions;
    } catch {
      return [];
    }
  }
}
