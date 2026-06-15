/**
 * Sidecar-launch-via-WSL command builder (Windows port, P6 / 1ec0a60a).
 *
 * The preferred Windows topology (decision 588c6df1) runs the Bun sidecar INSIDE
 * WSL — there `process.platform === 'linux'`, so the worker-session layer uses the
 * native `TmuxSessionMux` with no wrapping. The only Windows-native piece is how
 * Electron STARTS that sidecar: it shells out to `wsl.exe` to launch `bun` inside
 * the distro. This builds that command.
 *
 * Pure + unit-tested. NB: actual boot must be validated on a WSL2-capable host —
 * this VM's WSL2 is blocked by the Apple-Silicon/Parallels nested-virt wall
 * (doc winport-wsl-validation-2026-06-15). Wiring is guarded by `win32` so it
 * never affects the proven mac/linux launch path.
 *
 * Env crossing: Windows env does NOT cross into WSL automatically, and blindly
 * exporting all of `process.env` would leak the Windows PATH into Linux. So the
 * caller passes ONLY the vars the sidecar needs; path-valued ones (listed in
 * `pathKeys`) are translated Windows→WSL (`C:\… → /mnt/c/…`).
 */
import { winToWslPath } from '../session-mux/wsl-path.ts';

/** POSIX single-quote a value for safe inclusion in the bash prologue. */
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface WslSidecarLaunch {
  distro: string;
  /** The repo path INSIDE WSL (ext4 checkout, or a translated /mnt/c path). */
  repoWslPath: string;
  /** What to run inside WSL, e.g. { cmd: 'bun', args: ['run', 'src/server.ts'] }. */
  runtime: { cmd: string; args: string[] };
  /** Env vars to cross into the WSL process (only the sidecar's own — not all of process.env). */
  env: Record<string, string | undefined>;
  /** Keys in `env` whose VALUE is a Windows path needing Windows→WSL translation. */
  pathKeys?: string[];
}

/**
 * Build the `wsl.exe …` argv that launches the sidecar inside the distro:
 *   wsl.exe -d <distro> -- bash -lc 'export …; cd <repo>; exec bun run src/server.ts'
 * Returns `{ cmd, args }` ready for `spawn(cmd, args, …)`.
 */
export function buildWslSidecarCommand(opts: WslSidecarLaunch): { cmd: string; args: string[] } {
  const pathKeys = new Set(opts.pathKeys ?? []);
  const exports: string[] = [];
  for (const [k, raw] of Object.entries(opts.env)) {
    if (raw == null) continue;
    const value = pathKeys.has(k) ? winToWslPath(raw) : raw;
    exports.push(`export ${k}=${shq(value)}`);
  }
  const launch = [opts.runtime.cmd, ...opts.runtime.args.map(shq)].join(' ');
  const prologue = exports.length ? exports.join('; ') + '; ' : '';
  const script = `${prologue}cd ${shq(opts.repoWslPath)}; exec ${launch}`;
  return { cmd: 'wsl.exe', args: ['-d', opts.distro, '--', 'bash', '-lc', script] };
}
