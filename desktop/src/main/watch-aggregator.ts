import { WebSocket } from 'ws';

export interface WatchUpstream { id: string; host: string; port: number; token?: string; }
export interface WatchEvent { serverId: string; type: 'claude_session_registered' | 'claude_session_status' | 'claude_context_update'; project: string; session: string; [k: string]: unknown; }

const WATCHED_TYPES = new Set(['claude_session_registered', 'claude_session_status', 'claude_context_update']);

/** Per-server liveness (design §3B). connecting → live on open; a missed
 *  heartbeat pong degrades it, a second miss kills it (terminate → reconnect). */
export type ConnLiveness = 'connecting' | 'live' | 'degraded' | 'dead';

/** Tunable timings — overridable in tests so heartbeat/backoff run sub-second
 *  without faking the socket. Defaults are the production cadence (§3B). */
export interface AggregatorOptions {
  /** App-level WS ping period (default ~17s, in the 15–20s band). */
  heartbeatMs?: number;
  /** Grace for a pong after a ping before counting a miss (default ~10s). */
  pongGraceMs?: number;
  /** RNG for full-jitter backoff (default Math.random); injectable for tests. */
  rng?: () => number;
}

interface ConnState {
  ws: WebSocket;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  state: ConnLiveness;
  /** Consecutive missed heartbeat pongs (0 when healthy). */
  missed: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export class WatchAggregator {
  private conns = new Map<string, ConnState>();
  private removed = new Set<string>();
  private readonly heartbeatMs: number;
  private readonly pongGraceMs: number;
  private readonly rng: () => number;

  constructor(
    private forward: (e: WatchEvent) => void,
    private onOpen?: (id: string) => void,
    opts: AggregatorOptions = {},
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? 17_000;
    this.pongGraceMs = opts.pongGraceMs ?? 10_000;
    this.rng = opts.rng ?? Math.random;
  }

  /** Current liveness for a watched server, or undefined if not watched. */
  connectionState(id: string): ConnLiveness | undefined {
    return this.conns.get(id)?.state;
  }

  /** Broadcast a JSON message to every currently-open upstream ws. */
  broadcast(msg: unknown): void {
    const payload = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      try { if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(payload); } catch { /* ignore */ }
    }
  }

  setWatched(servers: WatchUpstream[]): void {
    const incoming = new Set(servers.map(s => s.id));
    for (const id of [...this.conns.keys()]) if (!incoming.has(id)) this.disconnect(id);
    for (const s of servers) if (!this.conns.has(s.id)) this.connect(s);
  }

  private connect(s: WatchUpstream): void {
    this.removed.delete(s.id);
    // Tear down any previous socket for this id (reconnect path) so it can't
    // double-forward messages or fire a stale close/error that bumps the new
    // attempt counter or schedules a duplicate reconnect.
    const prev = this.conns.get(s.id);
    const prevAttempt = prev?.attempt ?? 0;
    if (prev) {
      this.stopHeartbeat(prev);
      if (prev.timer) { clearTimeout(prev.timer); prev.timer = null; }
      try { prev.ws.removeAllListeners(); prev.ws.terminate(); } catch { /* ignore */ }
    }
    const ws = new WebSocket(`ws://${s.host}:${s.port}/ws`, s.token ? { headers: { authorization: `Bearer ${s.token}` } } : undefined);
    const st: ConnState = { ws, attempt: prevAttempt, timer: null, state: 'connecting', missed: 0, pingTimer: null, pongTimer: null };
    this.conns.set(s.id, st);
    // Reset backoff once a connection actually establishes, so a server that
    // blips repeatedly doesn't get stuck at the 15s cap forever; mark it live
    // and start the app-level heartbeat (§3B).
    ws.on('open', () => { const cur = this.conns.get(s.id); if (cur !== st) return; st.attempt = 0; st.state = 'live'; st.missed = 0; this.startHeartbeat(s.id, st); this.onOpen?.(s.id); });
    // A pong clears the outstanding miss-window and restores liveness.
    ws.on('pong', () => { if (this.conns.get(s.id) !== st) return; if (st.pongTimer) { clearTimeout(st.pongTimer); st.pongTimer = null; } st.missed = 0; st.state = 'live'; });
    // Forward only a well-formed watched event: a known type AND string
    // project+session (P2 §6 — first structural gate before remote-boundary's
    // zod validation downstream). A frame missing those is dropped here.
    ws.on('message', (data: any) => { try { const m = JSON.parse(data.toString()); if (m && WATCHED_TYPES.has(m.type) && typeof m.project === 'string' && typeof m.session === 'string') this.forward({ ...m, serverId: s.id }); } catch { /* ignore non-JSON */ } });
    ws.on('close', () => { const cur = this.conns.get(s.id); if (cur === st) { this.stopHeartbeat(st); st.state = 'dead'; } this.scheduleReconnect(s); });
    ws.on('error', () => { const cur = this.conns.get(s.id); if (cur === st) { this.stopHeartbeat(st); st.state = 'dead'; } this.scheduleReconnect(s); });
  }

  /** Start the per-conn app-level heartbeat: ping every heartbeatMs; a missing
   *  pong within pongGraceMs degrades, a second consecutive miss kills the
   *  socket (terminate → close → reconnect). No-op if already armed. */
  private startHeartbeat(id: string, st: ConnState): void {
    this.stopHeartbeat(st);
    st.pingTimer = setInterval(() => {
      if (this.conns.get(id) !== st) return;
      if (st.ws.readyState !== WebSocket.OPEN) return;
      // Arm the pong deadline for THIS ping (only if not already waiting).
      if (st.pongTimer === null) {
        st.pongTimer = setTimeout(() => {
          st.pongTimer = null;
          if (this.conns.get(id) !== st) return;
          st.missed += 1;
          if (st.missed >= 2) { st.state = 'dead'; try { st.ws.terminate(); } catch { /* ignore */ } }
          else { st.state = 'degraded'; }
        }, this.pongGraceMs);
      }
      try { st.ws.ping(); } catch { /* ignore — close/error path handles teardown */ }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(st: ConnState): void {
    if (st.pingTimer) { clearInterval(st.pingTimer); st.pingTimer = null; }
    if (st.pongTimer) { clearTimeout(st.pongTimer); st.pongTimer = null; }
  }

  /** Full-jitter exponential backoff (AWS "Exponential Backoff And Jitter"):
   *  a uniform random in [0, min(15s, 2^attempt·1s)). Spreading the delay
   *  uniformly stops a multi-server reconnect storm from thundering in lockstep. */
  private backoffDelay(attempt: number): number {
    const cap = Math.min(15000, 1000 * Math.pow(2, attempt));
    return Math.floor(this.rng() * cap);
  }

  private scheduleReconnect(s: WatchUpstream): void {
    if (this.removed.has(s.id)) return;
    const state = this.conns.get(s.id); if (!state) return;
    if (state.timer !== null) return;
    const delay = this.backoffDelay(state.attempt);
    state.timer = setTimeout(() => { state.timer = null; if (this.removed.has(s.id)) return; const cur = this.conns.get(s.id); if (!cur) return; cur.attempt++; this.connect(s); }, delay);
  }

  private disconnect(id: string): void {
    this.removed.add(id);
    const state = this.conns.get(id); if (!state) return;
    this.stopHeartbeat(state);
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    try { state.ws.terminate(); } catch { /* ignore */ }
    this.conns.delete(id);
  }

  stop(): void {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
    this.conns.clear();
  }
}
