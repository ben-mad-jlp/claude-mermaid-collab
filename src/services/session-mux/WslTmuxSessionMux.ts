/**
 * WslTmuxSessionMux — the Windows backend for the `drive-wsl-tmux` topology
 * (decision 588c6df1): the sidecar runs NATIVELY on Windows and drives real tmux
 * inside a WSL2 distro by prefixing every command with `wsl.exe -d <distro> --`.
 * Because tmux, `claude`, `ps`, and the git worktrees all live inside Linux, the
 * entire liveness/capture/naming layer works UNCHANGED — the only adaptation is
 * this argv wrap (+ Windows→WSL path translation for the one `-c <cwd>` arg).
 *
 * Validated 2026-06-15: the exact argv this produces drives real tmux-in-WSL
 * correctly (ensure/exists/list/panePid/sendKeys+capture/kill) — see doc
 * winport-wsl-validation-2026-06-15.
 *
 * Preferred alternative (sidecar-IN-WSL): when the sidecar itself runs inside WSL,
 * `process.platform === 'linux'` and the native `TmuxSessionMux` is used directly
 * with no wrapping — `WslTmuxSessionMux === TmuxSessionMux` in effect. This class
 * is the fallback for users who run the sidecar on the Windows side.
 */
import { TmuxSessionMux } from './TmuxSessionMux.ts';
import { winToWslPath } from './wsl-path.ts';
import { argvVersion } from './tmux-argv.ts';

export class WslTmuxSessionMux extends TmuxSessionMux {
  constructor(private readonly distro: string) {
    super();
  }

  /** Wrap the command for execution inside the WSL distro and translate any
   *  Windows path arg (e.g. `-c C:\repo` → `/mnt/c/repo`). Applies to both the
   *  `tmux …` and `ps …` argv — the `ps` snapshot MUST be the WSL process tree
   *  (that's where `claude` runs), so it too is dispatched through `wsl.exe`. */
  override cmd(argv: string[]): string[] {
    return ['wsl.exe', '-d', this.distro, '--', ...argv.map(winToWslPath)];
  }

  /** Probe `wsl.exe -d <distro> -- tmux -V`. Cached negative-uncached like the
   *  native probe is out of scope here; a per-call probe is fine (rare path). */
  override async available(): Promise<boolean> {
    try {
      const proc = Bun.spawn(this.cmd(argvVersion()), { stdout: 'ignore', stderr: 'ignore' });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}
