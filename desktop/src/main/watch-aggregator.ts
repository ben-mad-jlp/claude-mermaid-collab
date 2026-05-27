import { WebSocket } from 'ws';

export interface WatchUpstream { id: string; host: string; port: number; token?: string; }
export interface WatchEvent { serverId: string; type: 'claude_session_registered' | 'claude_session_status' | 'claude_context_update'; project: string; session: string; [k: string]: unknown; }

const WATCHED_TYPES = new Set(['claude_session_registered', 'claude_session_status', 'claude_context_update']);

interface ConnState { ws: WebSocket; attempt: number; timer: ReturnType<typeof setTimeout> | null; }

export class WatchAggregator {
  private conns = new Map<string, ConnState>();
  private removed = new Set<string>();

  constructor(private forward: (e: WatchEvent) => void) {}

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
      if (prev.timer) { clearTimeout(prev.timer); prev.timer = null; }
      try { prev.ws.removeAllListeners(); prev.ws.terminate(); } catch { /* ignore */ }
    }
    const ws = new WebSocket(`ws://${s.host}:${s.port}/ws`, s.token ? { headers: { authorization: `Bearer ${s.token}` } } : undefined);
    this.conns.set(s.id, { ws, attempt: prevAttempt, timer: null });
    // Reset backoff once a connection actually establishes, so a server that
    // blips repeatedly doesn't get stuck at the 15s cap forever.
    ws.on('open', () => { const st = this.conns.get(s.id); if (st) st.attempt = 0; });
    ws.on('message', (data: any) => { try { const m = JSON.parse(data.toString()); if (m && WATCHED_TYPES.has(m.type)) this.forward({ ...m, serverId: s.id }); } catch { /* ignore non-JSON */ } });
    ws.on('close', () => this.scheduleReconnect(s));
    ws.on('error', () => this.scheduleReconnect(s));
  }

  private scheduleReconnect(s: WatchUpstream): void {
    if (this.removed.has(s.id)) return;
    const state = this.conns.get(s.id); if (!state) return;
    if (state.timer !== null) return;
    const delay = Math.min(15000, 1000 * Math.pow(2, state.attempt));
    state.timer = setTimeout(() => { state.timer = null; if (this.removed.has(s.id)) return; const cur = this.conns.get(s.id); if (!cur) return; cur.attempt++; this.connect(s); }, delay);
  }

  private disconnect(id: string): void {
    this.removed.add(id);
    const state = this.conns.get(id); if (!state) return;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    try { state.ws.terminate(); } catch { /* ignore */ }
    this.conns.delete(id);
  }

  stop(): void {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
    this.conns.clear();
  }
}
