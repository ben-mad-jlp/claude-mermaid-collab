/**
 * The `mux` singleton — backend selection at one site.
 *
 * Today every platform uses the native `TmuxSessionMux`. The Windows backend
 * (`WslTmuxSessionMux`, decision 588c6df1) lands in P2 and slots in here behind a
 * `process.platform === 'win32'` check; the preferred topology (sidecar inside
 * WSL) keeps `cmd` the identity, so even on Windows this default is often correct.
 *
 * Every worker-session call-site dispatches its tmux/ps argv through
 * `mux.cmd(argv<Verb>(…))`, so swapping the backend here re-points the entire
 * fleet with no further changes.
 */
import type { SessionMux } from './SessionMux.ts';
import { TmuxSessionMux } from './TmuxSessionMux.ts';
import { WslTmuxSessionMux } from './WslTmuxSessionMux.ts';

/**
 * Backend selection at one site:
 * - **Windows native sidecar** (`process.platform === 'win32'`): drive tmux inside
 *   WSL via `WslTmuxSessionMux` (`MC_WSL_DISTRO`, default `Ubuntu`).
 * - **mac/linux — AND the sidecar running INSIDE WSL** (`platform === 'linux'`):
 *   the native `TmuxSessionMux`. This is the preferred Windows topology too
 *   (sidecar-in-WSL), where the seam needs no wrapping at all.
 */
export const mux: SessionMux =
  process.platform === 'win32'
    ? new WslTmuxSessionMux(process.env.MC_WSL_DISTRO || 'Ubuntu')
    : new TmuxSessionMux();

export type { SessionMux, SessionInfo } from './SessionMux.ts';
export * from './tmux-argv.ts';
