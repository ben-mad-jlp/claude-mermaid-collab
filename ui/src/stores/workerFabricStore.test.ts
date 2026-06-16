import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkerFabricStore, type WorkerPhaseEvent } from './workerFabricStore';

function phase(over: Partial<WorkerPhaseEvent>): WorkerPhaseEvent {
  return {
    type: 'worker_phase', project: '/p', session: 'lane-1', todoId: 't1',
    lifecycle: 'start', role: 'research', ts: 1, ...over,
  };
}

beforeEach(() => useWorkerFabricStore.getState().reset());

describe('workerFabricStore', () => {
  it('applyPhase tracks the current phase + route on start', () => {
    useWorkerFabricStore.getState().applyPhase(
      phase({ lifecycle: 'start', role: 'implement', provider: 'claude', model: 'claude-sonnet-4-6', source: 'override', winningScope: 'project' }),
    );
    const lane = useWorkerFabricStore.getState().lanes['t1'];
    expect(lane.phase).toBe('implement');
    expect(lane.alive).toBe(true);
    expect(lane.route).toEqual({ provider: 'claude', model: 'claude-sonnet-4-6', source: 'override', winningScope: 'project' });
    expect(lane.runCostUsd).toBe(0); // cost only accrues on end
  });

  it('accumulates run cost + per-phase cost on phase-end events', () => {
    const s = useWorkerFabricStore.getState();
    s.applyPhase(phase({ lifecycle: 'end', role: 'sizegate', costUsd: 0.1 }));
    s.applyPhase(phase({ lifecycle: 'end', role: 'research', costUsd: 0.25 }));
    const lane = useWorkerFabricStore.getState().lanes['t1'];
    expect(lane.runCostUsd).toBeCloseTo(0.35, 6);
    expect(lane.byPhase?.sizegate.usd).toBeCloseTo(0.1, 6);
    expect(lane.byPhase?.research.usd).toBeCloseTo(0.25, 6);
  });

  it('hydrate sets ledger-authoritative cost + liveness and retires unreported lanes', () => {
    const s = useWorkerFabricStore.getState();
    s.applyPhase(phase({ todoId: 't1', lifecycle: 'end', role: 'research', costUsd: 0.9 }));
    s.applyPhase(phase({ todoId: 't2', lifecycle: 'start', role: 'implement' }));
    // Server reports only t1 alive with an authoritative cost; t2 is gone.
    s.hydrate([{ todoId: 't1', session: 'lane-1', alive: true, runCostUsd: 1.5, byPhase: { research: { usd: 1.5 } } }]);
    const { lanes } = useWorkerFabricStore.getState();
    expect(lanes['t1'].runCostUsd).toBe(1.5); // ledger-authoritative wins over the live tally
    expect(lanes['t1'].alive).toBe(true);
    expect(lanes['t2'].alive).toBe(false); // not reported → retired
  });
});
