/**
 * Claim-time liveness probe filter (design-readiness-gates Phase 4 graft).
 *
 * For the ONE mechanical env case — a gate whose precondition is a service that
 * can be PROBED (e.g. the yolox backend on :8082) — the Coordinator consults this
 * guard at CLAIM time only. It is a pure FILTER over the ready set: a todo carrying
 * a `claimProbe` stays un-claimable while the probe fails, and becomes claimable
 * automatically once the probe passes — with NO status write and NO stored
 * cleared-bit (so it can never drift). For non-probeable gates (design, dataset,
 * manual env) the human [GATE] todo (P1) stays the mechanism; this only handles the
 * auto-clearing env case.
 *
 * Probe specs (string on the todo):
 *   tcp://host:port            — TCP connect succeeds
 *   host:port                  — shorthand for tcp://
 *   http(s)://host:port/path   — GET returns a non-5xx status
 *
 * The actual network probe is injectable (ProbeRunner) so the filter logic is
 * unit-testable without a live service.
 */
import { connect } from 'node:net';
import type { Todo } from './todo-store';

export interface Probe {
  kind: 'tcp' | 'http';
  url?: string;     // for http
  host?: string;    // for tcp
  port?: number;    // for tcp
}

/** Parse a probe spec; null when absent or unparseable (treated as "no probe"). */
export function parseProbe(spec: string | null | undefined): Probe | null {
  if (!spec) return null;
  const s = spec.trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return { kind: 'http', url: s };
  const tcp = s.startsWith('tcp://') ? s.slice('tcp://'.length) : s;
  const m = /^([^/:]+):(\d+)$/.exec(tcp);
  if (!m) return null;
  return { kind: 'tcp', host: m[1], port: parseInt(m[2], 10) };
}

export type ProbeRunner = (probe: Probe) => Promise<boolean>;

/** Real probe: a short TCP connect, or an HTTP GET that returns a non-5xx status. */
export const defaultProbeRunner: ProbeRunner = async (probe) => {
  if (probe.kind === 'http' && probe.url) {
    try {
      const res = await fetch(probe.url, { method: 'GET', signal: AbortSignal.timeout(2000) });
      return res.status < 500;
    } catch {
      return false;
    }
  }
  if (probe.kind === 'tcp' && probe.host && probe.port) {
    return new Promise<boolean>((resolve) => {
      const sock = connect({ host: probe.host!, port: probe.port!, timeout: 2000 });
      const done = (ok: boolean) => { try { sock.destroy(); } catch { /* ignore */ } resolve(ok); };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      sock.once('timeout', () => done(false));
    });
  }
  return false;
};

/**
 * Keep only todos that are claimable RIGHT NOW: those with no probe, plus those
 * whose probe currently passes. A todo with a failing probe is dropped (filtered,
 * never mutated) so the Coordinator simply doesn't claim it this tick; a later tick
 * re-probes and claims it once the service is up.
 */
export async function filterClaimable(
  todos: Todo[],
  runner: ProbeRunner = defaultProbeRunner,
): Promise<Todo[]> {
  const out: Todo[] = [];
  for (const t of todos) {
    const probe = parseProbe(t.claimProbe);
    if (!probe) { out.push(t); continue; }      // no probe → unaffected
    if (await runner(probe)) out.push(t);        // probe passes → claimable now
    // probe fails → filtered out this tick (no status write, no cleared-bit)
  }
  return out;
}
