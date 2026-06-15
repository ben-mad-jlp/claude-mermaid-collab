/**
 * SessionMux — the single seam every worker-session command word passes through.
 *
 * tmux's one irreplaceable property is that it is a *separate, long-lived process
 * that owns a worker's PTY by name and outlives whoever talks to it*. The
 * mac/linux backend IS the real tmux server (today's behavior, untouched). The
 * Windows backend (decision 588c6df1: require WSL2) runs the SAME tmux, just
 * inside WSL — so the entire liveness/capture/naming layer works unchanged and
 * the only platform-specific surface is how a `tmux`/`ps` argv is dispatched.
 *
 * That dispatch is the seam: `cmd(argv)` maps a command argv (built by the pure
 * `tmux-argv.ts` builders) to the argv actually spawned. On mac/linux it is the
 * identity — the produced argv is byte-identical to today's literals, asserted by
 * the golden-argv parity test. `WslTmuxSessionMux` (P2) overrides `cmd` to prefix
 * `wsl -d <distro> --` and translate any embedded path; if the sidecar itself runs
 * inside WSL, `cmd` stays the identity and `WslTmuxSessionMux === TmuxSessionMux`.
 *
 * Call-sites keep their own spawn options (sync vs async, stdout pipe/ignore,
 * error handling) verbatim — only the literal argv array becomes
 * `mux.cmd(argv<Verb>(…))`. This makes the extraction a zero-behavior-change
 * refactor on the live worker spine while consolidating dispatch to one point.
 */

/** A live worker session as reported by the backend's `list()`. */
export interface SessionInfo {
  /** The tmux base name — `mc-<repo>-<lane>` (tmuxBaseName). */
  name: string;
  /** Session creation time (epoch ms), or null when the backend can't report it.
   *  Restart-robust clock: survives a sidecar restart unlike an in-memory timer. */
  createdAt: number | null;
}

export interface SessionMux {
  /**
   * Map a tmux/ps command argv to the argv actually spawned for this platform.
   * Identity on the native tmux backend (byte-parity); the WSL backend wraps it.
   */
  cmd(argv: string[]): string[];

  /**
   * Whether the backend's `tmux` is reachable (probe + cache). Mirrors today's
   * `isTmuxAvailable()` so the platform-capability gate has one home.
   */
  available(): Promise<boolean>;

  /**
   * All live sessions the backend currently owns (tmux `list-sessions`). This is
   * the persistence-query that replaces the lost-on-restart in-memory worker-pool
   * registry: on sidecar startup we rebuild busy slots authoritatively from the
   * live set (P3) instead of guessing. Returns `[]` when no server/sessions exist.
   */
  list(): Promise<SessionInfo[]>;
}
