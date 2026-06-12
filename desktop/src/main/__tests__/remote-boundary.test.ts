/**
 * [P2] remote-boundary assertions (design §3A + §6, assertion #3).
 *
 * Assertion #3: a fake upstream returns GARBAGE for a known route → the
 * renderer-facing result is the fail-closed `{ ok:false, invalid_remote_payload }`
 * envelope, and the garbage is NEVER surfaced (the store can't ingest it).
 *
 * Plus the supporting boundary properties: envelope-only pass-through for unknown
 * routes, non-ok responses pass through, valid payloads pass, and the WatchEvent
 * validator drops malformed/forged events while forwarding well-formed ones.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  crossServerCall,
  validateRemotePayload,
  validateWatchEvent,
  INVALID_REMOTE_PAYLOAD,
  type RemoteEnvelope,
  type RemoteInvoker,
} from '../remote-boundary';

/** A fake main-process invoker returning a fixed envelope, recording the call. */
function fakeInvoker(envelope: RemoteEnvelope): RemoteInvoker {
  return vi.fn(async () => envelope);
}

describe('[P2] crossServerCall — fail-closed validation (assertion #3)', () => {
  it('garbage body on a KNOWN route → invalid_remote_payload, never the bytes', async () => {
    // Upstream answers 200 OK for a known route but with a shape that violates
    // the schema (no `supervised` array) — the SSRF/garbage-peer case.
    const garbage = { haha: 'pwned', supervised: 'not-an-array' };
    const invoke = fakeInvoker({ ok: true, status: 200, body: garbage });

    const res = await crossServerCall(invoke, 'srvX', { path: '/api/supervisor/supervised' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.body).toEqual(INVALID_REMOTE_PAYLOAD);
    // The garbage is structurally absent from the renderer-facing envelope.
    expect(res.body).not.toEqual(garbage);
    expect(JSON.stringify(res.body)).not.toContain('pwned');
  });

  it('non-object garbage (a string) on a known route is rejected too', async () => {
    const invoke = fakeInvoker({ ok: true, status: 200, body: '<html>error</html>' });
    const res = await crossServerCall(invoke, 'srvX', { path: '/api/supervisor/identity' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.body).toEqual(INVALID_REMOTE_PAYLOAD);
  });

  it('a VALID payload on a known route passes through unchanged', async () => {
    const good = { supervised: [{ project: '/p', session: 's' }] };
    const invoke = fakeInvoker({ ok: true, status: 200, body: good });
    const res = await crossServerCall(invoke, 'srvX', { path: '/api/supervisor/supervised' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(good);
  });

  it('an UNKNOWN route passes the body through (envelope-only gate, version-skew safe)', async () => {
    const body = { anything: 'goes', for: ['unknown', 'routes'] };
    const invoke = fakeInvoker({ ok: true, status: 200, body });
    const res = await crossServerCall(invoke, 'srvX', { path: '/api/some/new/route' });
    expect(res).toEqual({ ok: true, status: 200, body });
  });

  it('a non-ok upstream response passes through (legit error, not garbage-gated)', async () => {
    const invoke = fakeInvoker({ ok: false, status: 401, body: 'Unauthorized' });
    const res = await crossServerCall(invoke, 'srvX', { path: '/api/supervisor/supervised' });
    expect(res).toEqual({ ok: false, status: 401, body: 'Unauthorized' });
  });

  it('validateRemotePayload is the same gate used directly', () => {
    const bad = validateRemotePayload('/api/supervisor/supervised', { ok: true, status: 200, body: {} });
    expect(bad).toEqual({ ok: false, status: 502, body: INVALID_REMOTE_PAYLOAD });
  });
});

describe('[P2] validateWatchEvent — drop malformed/forged events (§6)', () => {
  const wellFormed = { serverId: 'srv1', type: 'claude_session_status', project: '/p', session: 's', status: 'waiting' };

  it('forwards a well-formed watch event (extra keys kept)', () => {
    const v = validateWatchEvent(wellFormed);
    expect(v).not.toBeNull();
    expect(v!.project).toBe('/p');
    expect((v as Record<string, unknown>).status).toBe('waiting');
  });

  it('drops an event with an unknown type', () => {
    expect(validateWatchEvent({ ...wellFormed, type: 'evil_type' })).toBeNull();
  });

  it('drops an event missing project/session', () => {
    expect(validateWatchEvent({ serverId: 'srv1', type: 'claude_session_status' })).toBeNull();
    expect(validateWatchEvent({ serverId: 'srv1', type: 'claude_session_status', project: 5, session: 's' })).toBeNull();
  });

  it('drops non-object junk', () => {
    for (const junk of ['nope', 42, null, undefined, ['a']]) expect(validateWatchEvent(junk)).toBeNull();
  });
});
