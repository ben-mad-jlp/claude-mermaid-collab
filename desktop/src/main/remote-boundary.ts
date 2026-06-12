/**
 * Remote boundary (design §3A + §6, [P2]).
 *
 * One choke-point every cross-server REST call and every inbound watch event
 * passes through, so a malicious/buggy peer cannot inject unvalidated bytes into
 * the renderer/store. It is fail-CLOSED: a known route whose response doesn't
 * match its schema yields a structured `invalid_remote_payload` envelope, NEVER
 * the raw upstream bytes.
 *
 * Stages of `crossServerCall`:
 *   ① allowPeer  — pairing gate. A no-op pass-through until P4 wires real
 *                  peer-pairing; kept here so P4 only fills in the body.
 *   ② invoke     — the actual main-process invoker (token injection stays in
 *                  main, in index.ts `invokeOnServer`); passed in as a dep so
 *                  this module is pure and unit-testable.
 *   ③ validate   — structural envelope gate always; PLUS a per-known-route zod
 *                  `safeParse` of the body on a successful response. Unknown
 *                  routes pass the body through as `unknown` (envelope-only), so
 *                  version-skew with a real peer never breaks a legit call.
 *   ④ fail-closed— on schema failure return {ok:false, status:502,
 *                  body:{error:'invalid_remote_payload'}}.
 *
 * `rateLimit` and `audit` are no-op seams (NOT wired on) so a later phase can
 * enable them without re-threading every call site.
 */
import { z } from 'zod';

/** The structured envelope every cross-server call resolves to — the exact shape
 *  renderer/store code already branches on (`{ ok, status, body }`). */
export interface RemoteEnvelope { ok: boolean; status: number; body: unknown }

/** The main-process invoker `crossServerCall` wraps (index.ts `invokeOnServer`). */
export type RemoteInvoker = (
  serverId: string,
  opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> },
) => Promise<RemoteEnvelope>;

/** ① Pairing gate — NO-OP pass-through until P4 wires real peer-pairing. Kept as
 *  a seam so P4 only fills in the body; today every peer is allowed. */
export function allowPeer(_serverId: string): boolean {
  return true;
}

/** No-op rate-limit seam (NOT wired on — P2 leaves it always-allow). */
export function rateLimit(_serverId: string): boolean {
  return true;
}

/** No-op audit seam (NOT wired on — P2 records nothing). */
export function audit(_event: { serverId: string; path: string; ok: boolean; status: number }): void {
  /* intentionally empty until a later phase enables auditing */
}

/** The fail-closed body returned when a known route's payload fails validation.
 *  A stable sentinel so callers/tests can match on it; never the raw bytes. */
export const INVALID_REMOTE_PAYLOAD = { error: 'invalid_remote_payload' } as const;

/** Per-known-route response schemas. Lenient (`.catchall(unknown)` keeps extra
 *  keys so version-skew doesn't break a real peer) but they REJECT a non-object
 *  body and enforce the fields the desktop actually reads. A route absent here is
 *  "unknown" → envelope-only gate, body passed through untouched. */
const ROUTE_SCHEMAS: Record<string, z.ZodType> = {
  '/api/supervisor/identity': z
    .object({ project: z.string().optional(), session: z.string().optional() })
    .catchall(z.unknown()),
  '/api/supervisor/supervised': z
    .object({
      supervised: z.array(z.object({ project: z.string(), session: z.string() }).catchall(z.unknown())),
    })
    .catchall(z.unknown()),
  '/api/ide/tmux-send-keys': z.object({}).catchall(z.unknown()),
  '/api/ide/create-terminal': z.object({}).catchall(z.unknown()),
};

/** Validate a successful response body for a KNOWN route. Returns the (parsed)
 *  envelope on success, or a fail-closed 502 `invalid_remote_payload` envelope on
 *  schema mismatch. Unknown routes are returned unchanged (envelope-only gate). */
export function validateRemotePayload(path: string, res: RemoteEnvelope): RemoteEnvelope {
  // Only gate successful responses for known routes. A non-ok envelope is a
  // legit upstream error (already token-checked etc.) — pass it through so the
  // caller sees the real status/body; the store guards on `ok` anyway.
  if (!res.ok) return res;
  const schema = ROUTE_SCHEMAS[path];
  if (!schema) return res; // unknown route → envelope-only, body stays `unknown`
  const parsed = schema.safeParse(res.body);
  if (!parsed.success) {
    return { ok: false, status: 502, body: { ...INVALID_REMOTE_PAYLOAD } };
  }
  return { ok: res.ok, status: res.status, body: parsed.data };
}

/**
 * The single cross-server REST choke-point: gate → invoke → validate. Renderer
 * and store code call this (via the `mc:invokeOnServer` IPC handler) and keep
 * receiving the exact `{ ok, status, body }` envelope, now fail-closed against a
 * garbage peer.
 */
export async function crossServerCall(
  invoke: RemoteInvoker,
  serverId: string,
  opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> },
): Promise<RemoteEnvelope> {
  // ① pairing gate (no-op until P4)
  if (!allowPeer(serverId)) {
    return { ok: false, status: 403, body: { error: 'peer_not_allowed' } };
  }
  // ② invoke (token injection stays in main, inside `invoke`)
  const res = await invoke(serverId, opts);
  audit({ serverId, path: opts.path, ok: res.ok, status: res.status }); // no-op seam
  // ③+④ validate / fail-closed
  return validateRemotePayload(opts.path, res);
}

/** WatchEvent schema — the inbound shape forwarded from a watched upstream. Must
 *  carry a known event `type` and string `project`/`session`; extra keys kept. */
const WatchEventSchema = z
  .object({
    serverId: z.string(),
    type: z.enum(['claude_session_registered', 'claude_session_status', 'claude_context_update']),
    project: z.string(),
    session: z.string(),
  })
  .catchall(z.unknown());

/** Validated WatchEvent (mirrors watch-aggregator's structural type). */
export type ValidatedWatchEvent = z.infer<typeof WatchEventSchema>;

/**
 * Validate an inbound watch event. Returns the event to FORWARD on success, or
 * `null` to DROP a malformed/forged event before it reaches the renderer or the
 * cross-machine nudge logic.
 */
export function validateWatchEvent(raw: unknown): ValidatedWatchEvent | null {
  const parsed = WatchEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
