/**
 * Smoke for the two-server verification spine ([H0], design §5).
 *
 * Proves the reusable scaffold in `two-server-harness.ts` works end-to-end: two
 * REAL sidecars spawn on distinct ephemeral ports, both answer `/api/health`, and
 * they tear down cleanly in afterAll. No product assertions yet — the phase leaves
 * import the rig helpers and write the real switch/lease/forged-frame assertions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  TwoServerRig,
  health,
  makeFakeUpstream,
  injectForgedFrame,
  connectRenderer,
  installFakeClock,
} from './two-server-harness';

describe('two-server harness scaffold (smoke)', () => {
  const rig = new TwoServerRig();

  beforeAll(async () => { await rig.start(); }, 60_000);
  afterAll(async () => { await rig.stop(); });

  it('spawns two real sidecars on distinct ports', () => {
    expect(rig.a).not.toBeNull();
    expect(rig.b).not.toBeNull();
    expect(rig.a!.port).not.toBe(rig.b!.port);
    expect(rig.a!.sessionId).not.toBe(rig.b!.sessionId);
  });

  it('both sidecars answer /api/health', async () => {
    expect(await health(rig.a!)).toBe(200);
    expect(await health(rig.b!)).toBe(200);
  });

  // The remaining helpers are part of the scaffold the phase leaves consume; the
  // smoke just confirms they are wired and self-consistent against the fake
  // upstream (no product behavior asserted).
  it('fake upstream + renderer client + forged-frame injector round-trip', async () => {
    const upstream = makeFakeUpstream();
    await upstream.ready();
    try {
      // Renderer client receives the echo of what it sends (upstream echoes).
      const client = await connectRenderer(upstream.url());
      client.send('hello');
      expect(await client.waitFor((m) => m === 'hello')).toBe('hello');
      await client.close();

      // Forged-frame injector pushes an arbitrary frame; the echo comes back.
      const inj = await injectForgedFrame(upstream.url(), { type: 'forged', seq: 1 });
      const echoed = await new Promise<string>((res) => inj.ws.once('message', (d) => res(d.toString())));
      expect(JSON.parse(echoed)).toEqual({ type: 'forged', seq: 1 });
      inj.close();
      await inj.done;
    } finally {
      await upstream.stop();
    }
  });

  it('installFakeClock makes lease/heartbeat timers advance sub-second', async () => {
    const clock = installFakeClock();
    try {
      let fired = false;
      setTimeout(() => { fired = true; }, 30_000); // a "lease expiry" 30s out
      await clock.advance(30_000);
      expect(fired).toBe(true);
    } finally {
      clock.restore();
    }
  });
});
