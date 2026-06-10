import { describe, it, expect } from 'bun:test';
import { shouldReapTmux, shouldReapIdleTmux, isProtectedSession, isWorkerLaneSession } from '../tmux-reaper.ts';

const H = 60 * 60 * 1000;
const MAX = 7 * 24 * H; // one week

describe('shouldReapTmux', () => {
  it('reaps an OLD session with no live claude and no TUI', () => {
    expect(shouldReapTmux({ ageMs: 8 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(true);
  });

  it('never reaps a young session (under the idle threshold)', () => {
    expect(shouldReapTmux({ ageMs: 2 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps a session with a live claude process (even if old)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: true, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps when the TUI is still present (old, claude not detected)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: false, hasTui: true }, MAX)).toBe(false);
  });

  it('fail-safe: never reaps when liveness is unknown (snapshot unavailable)', () => {
    expect(shouldReapTmux({ ageMs: 1000 * H, hasLiveClaude: null, hasTui: false }, MAX)).toBe(false);
  });

  it('NEVER reaps a protected (planner/steward/supervisor) session, however old/dead', () => {
    expect(shouldReapTmux({ ageMs: 9999 * H, hasLiveClaude: false, hasTui: false, protected: true }, MAX)).toBe(false);
  });

  it('only reaps once past a one-week age', () => {
    expect(shouldReapTmux({ ageMs: 6 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(false);
    expect(shouldReapTmux({ ageMs: 8 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(true);
  });
});

describe('isProtectedSession', () => {
  it('protects planner/design/steward/supervisor session slugs', () => {
    expect(isProtectedSession('mc-myproj-planner')).toBe(true);
    expect(isProtectedSession('mc-myproj-design')).toBe(true);
    expect(isProtectedSession('mc-myproj-steward')).toBe(true);
    expect(isProtectedSession('mc-mermaidcollab-supervisor')).toBe(true);
  });
  it('does not protect worker/pool/other sessions', () => {
    expect(isProtectedSession('mc-myproj-backend1')).toBe(false);
    expect(isProtectedSession('mc-myproj-ui2')).toBe(false);
  });
});

describe('isWorkerLaneSession', () => {
  it('recognizes typed pool lanes (with a slot number)', () => {
    expect(isWorkerLaneSession('mc-myproj-backend1')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-ui2')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-frontend3')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-general1')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-api1')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-library1')).toBe(true);
  });
  it('recognizes domain lanes with or without a slot', () => {
    expect(isWorkerLaneSession('mc-myproj-cad')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-cad1')).toBe(true);
    expect(isWorkerLaneSession('mc-myproj-gazebo')).toBe(true);
  });
  it('does NOT recognize protected/interactive/unknown sessions', () => {
    expect(isWorkerLaneSession('mc-myproj-planner')).toBe(false);
    expect(isWorkerLaneSession('mc-myproj-design')).toBe(false);
    expect(isWorkerLaneSession('mc-myproj-steward')).toBe(false);
    expect(isWorkerLaneSession('mc-myproj-brightcalmriver')).toBe(false); // interactive session
  });
});

describe('shouldReapIdleTmux', () => {
  const IDLE = 8 * H; // default idle-reap threshold

  it('reaps an OLD idle-at-prompt worker lane (alive claude, not working)', () => {
    expect(shouldReapIdleTmux({ ageMs: 40 * H, hasLiveClaude: true, isWorking: false, isWorker: true }, IDLE)).toBe(true);
  });

  it('never reaps a worker lane that is actively working (however old)', () => {
    expect(shouldReapIdleTmux({ ageMs: 99 * H, hasLiveClaude: true, isWorking: true, isWorker: true }, IDLE)).toBe(false);
  });

  it('never reaps a young idle lane (under the idle threshold)', () => {
    expect(shouldReapIdleTmux({ ageMs: 2 * H, hasLiveClaude: true, isWorking: false, isWorker: true }, IDLE)).toBe(false);
  });

  it('does NOT fire on a dead shell (no live claude — that is the dead path)', () => {
    expect(shouldReapIdleTmux({ ageMs: 40 * H, hasLiveClaude: false, isWorking: false, isWorker: true }, IDLE)).toBe(false);
  });

  it('fail-safe: never reaps when liveness is unknown', () => {
    expect(shouldReapIdleTmux({ ageMs: 40 * H, hasLiveClaude: null, isWorking: false, isWorker: true }, IDLE)).toBe(false);
  });

  it('never reaps a non-worker lane, even old/idle/alive (allowlist)', () => {
    expect(shouldReapIdleTmux({ ageMs: 99 * H, hasLiveClaude: true, isWorking: false, isWorker: false }, IDLE)).toBe(false);
  });

  it('never reaps a protected role (defense in depth over the allowlist)', () => {
    expect(shouldReapIdleTmux({ ageMs: 99 * H, hasLiveClaude: true, isWorking: false, isWorker: true, protected: true }, IDLE)).toBe(false);
  });
});
