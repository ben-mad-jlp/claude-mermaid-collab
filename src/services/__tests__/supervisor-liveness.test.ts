import { describe, it, expect } from 'bun:test';
import {
  supervisorLivenessTick,
  makeLivenessState,
  SPAWN_GRACE_MS,
  type SupervisorLivenessDeps,
  type LivenessState,
} from '../supervisor-liveness';
import type { SupervisorIdentity } from '../supervisor-store';

const STALE_AFTER = 60_000;

function identity(updatedAt: number): SupervisorIdentity {
  return { project: '/sup', session: 'supervisor', updatedAt, serverId: '', epoch: 1 };
}

/** Build deps over a mutable fake clock + identity, recording spawn calls. */
function harness(opts: {
  clock: { t: number };
  identity: SupervisorIdentity | null;
  spawnResult?: { started: boolean; reason?: string };
}): { deps: SupervisorLivenessDeps; spawns: Array<{ project: string; session: string }> } {
  const spawns: Array<{ project: string; session: string }> = [];
  const deps: SupervisorLivenessDeps = {
    now: () => opts.clock.t,
    getIdentity: () => opts.identity,
    getConfig: () => ({ project: '/sup', session: 'supervisor' }),
    staleAfterMs: STALE_AFTER,
    spawn: async (project, session) => {
      spawns.push({ project, session });
      return opts.spawnResult ?? { started: true };
    },
  };
  return { deps, spawns };
}

describe('supervisorLivenessTick', () => {
  it('does nothing when the supervisor heartbeat is fresh', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: identity(clock.t - 5_000) }); // 5s old < 60s
    const r = await supervisorLivenessTick(deps, makeLivenessState());
    expect(r.action).toBe('healthy');
    expect(spawns).toHaveLength(0);
  });

  it('spawns when no supervisor is registered (absent)', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: null });
    const state = makeLivenessState();
    const r = await supervisorLivenessTick(deps, state);
    expect(r.action).toBe('spawned');
    expect(spawns).toEqual([{ project: '/sup', session: 'supervisor' }]);
    expect(state.lastSpawnAt).toBe(clock.t);
    expect(state.spawning).toBe(false); // flag cleared after spawn
  });

  it('respawns when the heartbeat is stale', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: identity(clock.t - (STALE_AFTER + 1)) });
    const r = await supervisorLivenessTick(deps, makeLivenessState());
    expect(r.action).toBe('respawned');
    expect(spawns).toHaveLength(1);
  });

  it('does NOT spawn again within the grace window after a spawn', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: null });
    const state = makeLivenessState();
    await supervisorLivenessTick(deps, state); // spawns
    expect(spawns).toHaveLength(1);

    // Heartbeat still absent (new lane hasn't registered yet), clock advanced a bit.
    clock.t += SPAWN_GRACE_MS - 1;
    const r = await supervisorLivenessTick(deps, state);
    expect(r.action).toBe('grace');
    expect(spawns).toHaveLength(1); // no second spawn
  });

  it('respawns again once the grace window expires and it is still dead', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: null });
    const state = makeLivenessState();
    await supervisorLivenessTick(deps, state); // spawn #1
    clock.t += SPAWN_GRACE_MS + 1; // grace expired
    const r = await supervisorLivenessTick(deps, state); // still absent → spawn #2
    expect(r.action).toBe('spawned');
    expect(spawns).toHaveLength(2);
  });

  it('skips while a spawn is in flight (no double-spawn)', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: null });
    const state: LivenessState = { spawning: true, lastSpawnAt: 0 };
    const r = await supervisorLivenessTick(deps, state);
    expect(r.action).toBe('spawn-in-flight');
    expect(spawns).toHaveLength(0);
  });

  it('reports spawn-failed (and stays out of grace? no — records lastSpawnAt) when launch fails', async () => {
    const clock = { t: 1_000_000 };
    const { deps, spawns } = harness({ clock, identity: null, spawnResult: { started: false, reason: 'no-tmux' } });
    const state = makeLivenessState();
    const r = await supervisorLivenessTick(deps, state);
    expect(r.action).toBe('spawn-failed');
    expect(r.reason).toBe('no-tmux');
    expect(spawns).toHaveLength(1);
    // lastSpawnAt is set so we still back off briefly rather than hammering a
    // broken launch path every tick.
    expect(state.lastSpawnAt).toBe(clock.t);
  });
});
