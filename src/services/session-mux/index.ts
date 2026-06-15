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

export const mux: SessionMux = new TmuxSessionMux();

export type { SessionMux } from './SessionMux.ts';
export * from './tmux-argv.ts';
