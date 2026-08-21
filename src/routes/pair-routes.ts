/**
 * Phone pairing seam (design: zen-phone-pairing-design).
 *
 * Hands the bearer token to the user's own iPhone so the native Zen app can
 * authenticate over Tailscale. SECURITY: these routes RETURN the root secret, so
 * they are LOOPBACK-ONLY — the handler's first act is a non-loopback 403, BEFORE
 * any token generation or readout. This closes the bootstrap hole: with no token
 * configured `checkAuth` allows all peers, so without this guard a remote tailnet
 * peer could hit GET /api/pair, trigger token generation, and receive it.
 *
 * Token auto-provisioning (generate + persist when none exists) therefore only
 * ever happens for a loopback caller (the desktop UI's "Phone access" panel).
 */

import { spawnSync } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import { isLoopbackPeer } from '../auth.ts';
import { getAuthToken, generateAuthToken, setAuthToken } from '../services/config-file.ts';
import { config } from '../config.ts';
import { readDesktopFleet, type FleetServer } from '../services/desktop-fleet.ts';
import {
  PAIRING_PAYLOAD_VERSION,
  buildPairingPayloadV2,
  buildPairingQrValue,
  type PairingServerEntry,
} from '../services/pairing-payload.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface HostCandidate {
  address: string;
  iface: string;
  /** True for the 100.64.0.0/10 CGNAT range Tailscale assigns — a HINT, not a guarantee. */
  likelyTailscale: boolean;
}

/** Non-loopback IPv4 addresses, Tailscale-CGNAT candidates first. */
export function discoverHosts(): HostCandidate[] {
  const out: HostCandidate[] = [];
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ address: a.address, iface: name, likelyTailscale: isCgnat(a.address) });
    }
  }
  // Tailscale candidates first (most likely the reachable address for the phone).
  return out.sort((x, y) => Number(y.likelyTailscale) - Number(x.likelyTailscale));
}

/** True for 100.64.0.0/10 (the CGNAT range Tailscale draws tailnet IPs from). */
function isCgnat(ip: string): boolean {
  const m = ip.split('.');
  if (m.length !== 4) return false;
  const a = Number(m[0]), b = Number(m[1]);
  return a === 100 && b >= 64 && b <= 127;
}

/** True when the server is bound to loopback only (the phone can't reach it). */
function boundToLoopback(): boolean {
  return isLoopbackPeer(config.HOST) || config.HOST === 'localhost';
}

/** True for an address that means "this device" — useless inside a pairing payload. */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || isLoopbackPeer(host);
}

/** Candidate tailscale CLI locations, macOS app bundle first. */
const TAILSCALE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  'tailscale',
];

/** Memoized across requests: shelling out per /api/pair call would be wasteful. */
let magicDnsMemo: string | null | undefined;

/**
 * This machine's MagicDNS name (e.g. `bens-macbook-pro.tail445728.ts.net`), or null.
 *
 * WHY a NAME and not the 100.x IP: iOS App Transport Security exempts cleartext by
 * DOMAIN, never by address, and Tailscale's CGNAT range is not covered by
 * NSAllowsLocalNetworking. A payload carrying the raw tailnet IP is refused by the
 * phone before the request is even sent. `MERMAID_TAILNET_HOST` overrides for tests
 * and for hosts where the CLI is absent.
 */
export function selfMagicDnsHost(): string | null {
  const override = process.env.MERMAID_TAILNET_HOST?.trim();
  if (override) return override;
  if (magicDnsMemo !== undefined) return magicDnsMemo;
  magicDnsMemo = null;
  for (const bin of TAILSCALE_BINARIES) {
    try {
      const out = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 4000 });
      if (out.status !== 0 || !out.stdout) continue;
      const name = JSON.parse(out.stdout)?.Self?.DNSName;
      if (typeof name === 'string' && name.length > 1) {
        magicDnsMemo = name.replace(/\.$/, '');
        break;
      }
    } catch {
      // Any failure just means "no MagicDNS name" — the IP fallback still works.
    }
  }
  return magicDnsMemo;
}


/**
 * The fleet WITH real per-server tokens, asked of the Electron main process.
 *
 * `servers.json` stores a peer's credential as `encryptedToken`, sealed with the OS
 * keystore — only main can open it. Reading the file here yields entries with NO token,
 * and the old `f.token ?? token` fallback then advertised peers with THIS server's
 * credential; the phone was rejected by that peer and unpaired itself in a loop
 * (2026-08-21). Main serves them over the existing loopback + bearer control channel, so
 * tokens are never written to disk or placed in an environment variable. Falls back to
 * the on-disk fleet when the control channel is absent (a bare `bun run src/server.ts`).
 */
export type ControlFleetSource = () => Promise<FleetServer[] | null>;

/** Default control-fleet source: the env-driven Electron main control channel. */
export const envControlFleet: ControlFleetSource = async () => {
  const base = process.env.MC_DESKTOP_CONTROL_URL;
  const controlToken = process.env.MC_DESKTOP_CONTROL_TOKEN;
  if (base && controlToken) {
    try {
      const res = await fetch(`${base}/fleet/tokens`, {
        headers: { authorization: `Bearer ${controlToken}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = (await res.json()) as { servers?: FleetServer[] };
        if (Array.isArray(body.servers) && body.servers.length > 0) return body.servers;
      }
    } catch {
      // Main unreachable or wedged — fall through to the on-disk fleet.
    }
  }
  return null;
};

async function fleetWithTokens(
  readFleet: () => FleetServer[],
  controlFleet: ControlFleetSource = envControlFleet
): Promise<FleetServer[]> {
  const fromControl = await controlFleet();
  if (fromControl && fromControl.length > 0) return fromControl;
  return readFleet();
}

/** Build the pairing payload (token + reachable hosts + fleet + QR deep link). */
async function pairingPayload(
  readFleet: () => FleetServer[] = readDesktopFleet,
  controlFleet: ControlFleetSource = envControlFleet,
  onlyServerId?: string,
): Promise<{
  version: typeof PAIRING_PAYLOAD_VERSION;
  token: string;
  port: number;
  bound: string;
  hosts: HostCandidate[];
  servers: PairingServerEntry[];
  qr: string;
  warning?: string;
}> {
  // Ensure a token exists (auto-provision on first pair — loopback caller only).
  let token = getAuthToken();
  if (!token) {
    token = generateAuthToken();
    setAuthToken(token);
  }
  const port = config.PORT;
  const hosts = discoverHosts();
  const best = hosts[0]?.address;

  // Fleet readout must degrade to [] even if the injected reader throws, so a
  // broken desktop servers.json never blocks pairing with this server alone.
  let fleet: FleetServer[];
  try {
    fleet = await fleetWithTokens(readFleet, controlFleet);
  } catch {
    fleet = [];
  }
  const selfHost = `${selfMagicDnsHost() ?? best ?? config.HOST}:${port}`;
  // A fleet entry with NO token of its own must NOT inherit THIS server's token: the
  // phone would then call that peer with a credential it never accepts, get a 401, and
  // (before the client-side scoping fix) tear down the whole pairing. Observed
  // 2026-08-21: trimaxion was advertised with the Mac's token, so the phone bounced back
  // to the pairing screen in a loop while the Mac itself logged nothing. A peer we cannot
  // hand a working credential for is better left out of the payload than misdescribed.
  const selfIsLoopback = (f: FleetServer) => isLoopbackHost(f.host);
  const usableFleet = fleet.filter((f) => Boolean(f.token) || selfIsLoopback(f));
  const servers: PairingServerEntry[] =
    usableFleet.length > 0
      ? usableFleet.map((f) => ({
          id: f.id,
          label: f.label,
          // A pairing payload is consumed on ANOTHER device, where a loopback address
          // means THAT device. The desktop stores its own server as 127.0.0.1, and
          // emitting it verbatim handed the phone an address pointing at itself — it
          // then sat on "can't reach the server" no matter how often it was scanned
          // (observed 2026-08-21). Substitute the best routable address we discovered
          // for the LOCAL entry; remote entries already carry a reachable host.
          host: `${isLoopbackHost(f.host) ? (selfMagicDnsHost() ?? best ?? f.host) : f.host}:${f.port}`,
          token: f.token ?? token,
        }))
      : [{ id: selfHost, label: hostname(), host: selfHost, token }];

  // ONE server per QR (operator decision 2026-08-21). Pairing a whole fleet in a single
  // scan bundled every server's credential into one code, which made the payload large
  // and dense enough to be hard to scan, and meant one unreachable peer polluted the
  // pairing. A per-server code is small, and adding a machine is a deliberate act.
  const advertised = onlyServerId ? servers.filter((s) => s.id === onlyServerId) : servers;
  const qr = buildPairingQrValue(buildPairingPayloadV2(advertised));
  const warning = boundToLoopback()
    ? `Server is bound to ${config.HOST} (loopback) — your phone can't reach it. Relaunch with MERMAID_BIND_HOST=0.0.0.0 (or the tailnet IP) so the phone can connect.`
    : hosts.length === 0
      ? 'No non-loopback network interface found — connect to a network (e.g. Tailscale) so the phone has a route.'
      : undefined;
  return { version: PAIRING_PAYLOAD_VERSION, token, port, bound: config.HOST, hosts, servers: advertised, qr, warning };
}

/**
 * Routes:
 *   GET  /api/pair          → pairing payload (auto-provisions a token if none)
 *   POST /api/pair/rotate   → rotate the token, return the fresh pairing payload
 *   GET  /api/auth/check    → gated liveness probe; 200 here means the token is
 *                             still valid (it reached the handler past checkAuth).
 *                             The iOS app pings it on launch + WS reconnect; a 401
 *                             (from checkAuth, when the token is stale) drives re-pair.
 * Returns null when the path isn't ours (so the server falls through to other routes).
 */
export interface PairRouteDeps {
  readFleet?: () => FleetServer[];
  controlFleet?: ControlFleetSource;
}

export async function handlePairRoutes(
  req: Request,
  url: URL,
  peerAddress?: string | null,
  deps?: PairRouteDeps
): Promise<Response | null> {
  // /api/auth/check is gated by checkAuth (NOT loopback-only) — reaching here means
  // the caller already presented a valid token (or is loopback). Just confirm.
  if (url.pathname === '/api/auth/check' && req.method === 'GET') {
    return Response.json({ ok: true });
  }

  if (url.pathname === '/api/pair' || url.pathname === '/api/pair/rotate') {
    // LOOPBACK-ONLY — 403 FIRST, before any token generation/readout. This is the
    // defense-in-depth that closes the no-token bootstrap hole (see file header).
    if (!isLoopbackPeer(peerAddress)) {
      return jsonError('Pairing is only available from the local machine (loopback).', 403);
    }
    if (url.pathname === '/api/pair' && req.method === 'GET') {
      const only = url.searchParams.get('serverId') || undefined;
      return Response.json(
        await pairingPayload(
          deps?.readFleet ?? readDesktopFleet,
          deps?.controlFleet ?? envControlFleet,
          only,
        )
      );
    }
    if (url.pathname === '/api/pair/rotate' && req.method === 'POST') {
      setAuthToken(generateAuthToken());
      return Response.json(
        await pairingPayload(deps?.readFleet ?? readDesktopFleet, deps?.controlFleet ?? envControlFleet)
      );
    }
    return jsonError('Method not allowed', 405);
  }

  return null;
}
