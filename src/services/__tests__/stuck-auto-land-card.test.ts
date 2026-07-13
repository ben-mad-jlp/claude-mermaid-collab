import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-stuck-land-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { surfaceStuckAutoLand, deriveStuckAutoLandAction } from '../coordinator-live';
import { listOpenEscalations, _closeDb as _closeSupervisorDb } from '../supervisor-store';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('stuck auto-land card — operator-visible signal when daemon retries same red reason', () => {
  let project: string;
  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'stuck-land-proj-')); });
  afterEach(() => { try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('three consecutive same-reason reds → exactly one card surfaces at threshold', () => {
    const epicId = 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb';
    const epicBranch = 'epic/abcdef12';
    const reason = 'build-proof-red:land-gate-failed';

    // Drive deriveStuckAutoLandAction three times, feeding next back in
    let prev = undefined;
    let action1 = deriveStuckAutoLandAction(prev, { green: false, reason });
    expect(action1.surface).toBe(false);
    expect(action1.next?.count).toBe(1);

    prev = action1.next;
    let action2 = deriveStuckAutoLandAction(prev, { green: false, reason });
    expect(action2.surface).toBe(false);
    expect(action2.next?.count).toBe(2);

    prev = action2.next;
    let action3 = deriveStuckAutoLandAction(prev, { green: false, reason });
    expect(action3.surface).toBe(true); // exactly at threshold
    expect(action3.next?.count).toBe(3);

    // Surface the card at the threshold tick
    const card = surfaceStuckAutoLand(project, 'coordinator', { epicId, epicBranch, reason });
    expect(card.isNew).toBe(true);
    expect(card.escalation.kind).toBe('blocker');
    expect(card.escalation.questionText).toContain('STUCK');
    expect(card.escalation.questionText).toContain('epic/abcdef12');
    expect(card.escalation.questionText).toContain('abcdef12');
    expect(card.escalation.questionText).toContain('land-gate-failed');

    const open = listOpenEscalations().filter((e) => e.project === project);
    expect(open.length).toBe(1);
  });

  it('fourth consecutive same-reason red is idempotent (dedup)', () => {
    const epicId = 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb';
    const epicBranch = 'epic/abcdef12';
    const reason = 'build-proof-red:land-gate-failed';

    // Drive to threshold (3 reds)
    let prev = undefined;
    for (let i = 0; i < 3; i++) {
      const action = deriveStuckAutoLandAction(prev, { green: false, reason });
      prev = action.next;
    }

    const card1 = surfaceStuckAutoLand(project, 'coordinator', { epicId, epicBranch, reason });
    const cardId1 = card1.escalation.id;
    expect(card1.isNew).toBe(true);

    // Fourth red with same reason
    const action4 = deriveStuckAutoLandAction(prev, { green: false, reason });
    expect(action4.surface).toBe(false); // not at threshold
    const card2 = surfaceStuckAutoLand(project, 'coordinator', { epicId, epicBranch, reason });
    expect(card2.isNew).toBe(false); // deduped
    expect(card2.escalation.id).toBe(cardId1); // same card
    expect(listOpenEscalations().filter((e) => e.project === project).length).toBe(1);
  });

  it('differing red reason resets counter and resolves previous', () => {
    const prev = { reason: 'build-proof-red:land-gate-failed', count: 2, escalationId: 'card-1' };
    const action = deriveStuckAutoLandAction(prev, { green: false, reason: 'build-proof-red:land-gate-incident' });

    expect(action.next?.reason).toBe('build-proof-red:land-gate-incident');
    expect(action.next?.count).toBe(1);
    expect(action.surface).toBe(false);
    expect(action.resolvePrevious).toBe(true);
  });

  it('green derivation resets counter and resolves previous', () => {
    const prev = { reason: 'build-proof-red:land-gate-failed', count: 2, escalationId: 'card-1' };
    const action = deriveStuckAutoLandAction(prev, { green: true });

    expect(action.next).toBeNull();
    expect(action.surface).toBe(false);
    expect(action.resolvePrevious).toBe(true);
  });

  it('green derivation with no prior card is a no-op', () => {
    const action = deriveStuckAutoLandAction(undefined, { green: true });

    expect(action.next).toBeNull();
    expect(action.surface).toBe(false);
    expect(action.resolvePrevious).toBe(false);
  });

  it('first-ever red derivation starts counter at count 1', () => {
    const action = deriveStuckAutoLandAction(undefined, { green: false, reason: 'build-proof-red:land-gate-failed' });

    expect(action.next?.reason).toBe('build-proof-red:land-gate-failed');
    expect(action.next?.count).toBe(1);
    expect(action.surface).toBe(false);
    expect(action.resolvePrevious).toBe(false);
  });

  it('questionText has no per-run token (stable dedup)', () => {
    const epicId = 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb';
    const epicBranch = 'epic/abcdef12';
    const reason = 'build-proof-red:land-gate-failed';
    const ctx = { epicId, epicBranch, reason };

    const card1 = surfaceStuckAutoLand(project, 'coordinator', ctx);
    const questionText1 = card1.escalation.questionText;

    // Check no digit-timestamp (10+ consecutive digits indicate a token)
    expect(/\d{10,}/.test(questionText1)).toBe(false);

    // Second call with identical ctx produces identical questionText (for dedup)
    const card2 = surfaceStuckAutoLand(project, 'coordinator', ctx);
    expect(card2.escalation.questionText).toBe(questionText1);

    // Text contains the stable facts
    expect(questionText1).toContain('abcdef12'); // epicId.slice(0,8)
    expect(questionText1).toContain('epic/abcdef12'); // epicBranch
    expect(questionText1).toContain('land-gate-failed'); // reason
  });
});
