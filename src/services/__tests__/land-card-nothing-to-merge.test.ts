/**
 * Unit tests for surfaceEpicLand's nothing-to-merge short-circuit.
 *
 * Mirrors the reconcile-pass.test.ts harness: isolates the global supervisor.db via
 * MERMAID_SUPERVISOR_DIR, isolates the per-project todo DB via a temp dir.
 * No real git repo needed; getWorktreeManager fails gracefully to safe defaults.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// -----------------------------------------------------------------------
// Isolation: point the global supervisor.db at a temp dir BEFORE the store
// opens it (module initialisation order).
// -----------------------------------------------------------------------
const supDir = mkdtempSync(join(tmpdir(), 'lnm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import {
  _closeDb,
  listEscalationsByKindInWindow,
} from '../supervisor-store';
import { createTodo, updateTodo } from '../todo-store';
import { surfaceEpicLand } from '../coordinator-land';

// -----------------------------------------------------------------------
// Per-project todo DB isolation: use a temp directory as the "project path"
// -----------------------------------------------------------------------
const todoBase = mkdtempSync(join(tmpdir(), 'lnm-todos-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
beforeAll(() => {
  _closeDb();
});
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('surfaceEpicLand — nothing-to-merge short-circuit', () => {
  it('suppresses the epic-ready-to-land card when the epic is already reachable from trunk', async () => {
    const project = freshProject();
    const session = 'test-session';

    // Create a minimal epic with one build-child leaf so byRepo is non-empty
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: 'Test Epic',
      kind: 'epic',
      status: 'planned',
    });

    const child = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'worker',
      title: 'Test Leaf',
      kind: 'leaf',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark the child as done+accepted
    await updateTodo(project, child.id, { status: 'done', acceptanceStatus: 'accepted' });

    // Call surfaceEpicLand with a stub landednessProbe that reports the epic is already landed
    await surfaceEpicLand(project, epic.id, {
      sessionHint: session,
      landednessProbe: {
        isEpicLandedInGit: async () => 'landed',
        isEpicTreeIdenticalToTrunk: async () => 'identical',
      },
    });

    // Assert: no epic-ready-to-land card was created
    const cards = listEscalationsByKindInWindow(
      project,
      'epic-ready-to-land',
      0,
      Date.now(),
    );
    expect(cards.length).toBe(0);
  });

  it('still raises the card when the branch has commits absent from trunk', async () => {
    const project = freshProject();
    const session = 'test-session';

    // Create a minimal epic with one build-child leaf so byRepo is non-empty
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: 'Test Epic',
      kind: 'epic',
      status: 'planned',
    });

    const child = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'worker',
      title: 'Test Leaf',
      kind: 'leaf',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark the child as done+accepted
    await updateTodo(project, child.id, { status: 'done', acceptanceStatus: 'accepted' });

    // Call surfaceEpicLand with a stub landednessProbe that reports commits are ahead
    await surfaceEpicLand(project, epic.id, {
      sessionHint: session,
      landednessProbe: {
        isEpicLandedInGit: async () => 'not-landed',
        isEpicTreeIdenticalToTrunk: async () => 'differs',
      },
    });

    // Assert: epic-ready-to-land card WAS created
    const cards = listEscalationsByKindInWindow(
      project,
      'epic-ready-to-land',
      0,
      Date.now(),
    );
    expect(cards.length).toBe(1);
  });

  it('still raises the card when the git probe is indeterminate', async () => {
    const project = freshProject();
    const session = 'test-session';

    // Create a minimal epic with one build-child leaf so byRepo is non-empty
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: 'Test Epic',
      kind: 'epic',
      status: 'planned',
    });

    const child = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'worker',
      title: 'Test Leaf',
      kind: 'leaf',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark the child as done+accepted
    await updateTodo(project, child.id, { status: 'done', acceptanceStatus: 'accepted' });

    // Call surfaceEpicLand with a stub landednessProbe that reports indeterminate status
    // (fail-safe: treat as "we don't know" and raise the card)
    await surfaceEpicLand(project, epic.id, {
      sessionHint: session,
      landednessProbe: {
        isEpicLandedInGit: async () => 'indeterminate',
        isEpicTreeIdenticalToTrunk: async () => 'indeterminate',
      },
    });

    // Assert: epic-ready-to-land card WAS created (same as case 2 — proves fail-safe)
    const cards = listEscalationsByKindInWindow(
      project,
      'epic-ready-to-land',
      0,
      Date.now(),
    );
    expect(cards.length).toBe(1);
  });
});

describe('surfaceEpicLand — read-only auto-land (identical tree, not yet merged)', () => {
  it('creates a RECORD card and lands through the injected landEpic, no human question left open', async () => {
    const project = freshProject();
    const epic = await createTodo(project, {
      allowOrphan: true, ownerSession: 'planner', title: 'Read-only Epic', kind: 'epic', status: 'planned',
    });
    const child = await createTodo(project, {
      allowOrphan: true, ownerSession: 'worker', title: 'Explore Leaf', kind: 'leaf', parentId: epic.id, status: 'ready',
    });
    await updateTodo(project, child.id, { status: 'done', acceptanceStatus: 'accepted' });

    const landedWith: string[] = [];
    await surfaceEpicLand(project, epic.id, {
      sessionHint: 'test-session',
      landednessProbe: {
        isEpicLandedInGit: async () => 'not-landed',
        isEpicTreeIdenticalToTrunk: async () => 'identical',
      },
      landEpicFn: async (_project, target) => {
        landedWith.push(typeof target === 'string' ? target : target.escalationId ?? '');
        return { landed: true, reason: 'ok' } as never;
      },
    });

    const cards = listEscalationsByKindInWindow(project, 'epic-ready-to-land', 0, Date.now());
    expect(cards.length).toBe(1); // the record card exists…
    expect(cards[0]!.questionText).toContain('READ-ONLY'); // …and says so
    expect(landedWith.length).toBe(1); // the land actually fired, once
    expect(landedWith[0]).toBe(cards[0]!.id); // through the record card's own id
  });

  it('an INDETERMINATE tree probe never auto-lands (fail-closed to the normal card path)', async () => {
    const project = freshProject();
    const epic = await createTodo(project, {
      allowOrphan: true, ownerSession: 'planner', title: 'Indeterminate Epic', kind: 'epic', status: 'planned',
    });
    const child = await createTodo(project, {
      allowOrphan: true, ownerSession: 'worker', title: 'Leaf', kind: 'leaf', parentId: epic.id, status: 'ready',
    });
    await updateTodo(project, child.id, { status: 'done', acceptanceStatus: 'accepted' });

    const landedWith: string[] = [];
    await surfaceEpicLand(project, epic.id, {
      sessionHint: 'test-session',
      landednessProbe: {
        isEpicLandedInGit: async () => 'not-landed',
        isEpicTreeIdenticalToTrunk: async () => 'indeterminate',
      },
      landEpicFn: async (_project, target) => {
        landedWith.push(typeof target === 'string' ? target : target.escalationId ?? '');
        return { landed: true, reason: 'ok' } as never;
      },
    });

    expect(landedWith.length).toBe(0); // no auto-land on an uncertain probe
  });
});
