import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-throttle-sup-'));

import { sweepCorruptEpics, _resetCorruptEpicSweepState, CORRUPT_EPIC_SWEEP_INTERVAL_MS } from '../coordinator-live';
import { buildEpicBranchStatus, type BranchProbe, type GitProbe } from '../epic-branch-status';
import { createTodo, completeTodo, getTodo, listTodos } from '../todo-store';

const probeWith = (facts: Record<string, BranchProbe>): GitProbe =>
  (branch) => facts[branch] ?? { exists: false, ahead: null, behind: null, mergeable: null };

describe('corrupt-sweep-throttle', () => {
  it('throttles sweepCorruptEpics to a per-project interval', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-throttle-repo-'));
    _resetCorruptEpicSweepState();

    // Build one corrupt epic + land leaf
    const epic = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[EPIC] throttle test',
      kind: 'epic',
      status: 'planned',
    });
    const land = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[LAND] throttle test → master',
      parentId: epic.id,
      kind: 'land',
      status: 'planned',
    });
    await completeTodo(repo, land.id, 'accepted'); // FALSELY stamp the land leaf done

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const probe = probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true } });

    // Use a large base time to avoid throttle issues with small now values
    const baseTime = 1000000000;

    // First sweep at baseTime should reopen the land leaf
    const report1 = buildEpicBranchStatus(listTodos(repo, { includeCompleted: true }), probe);
    const reopened1 = await sweepCorruptEpics(repo, { report: report1, now: baseTime });
    expect(reopened1).toContain(land.id);
    expect(getTodo(repo, land.id)!.status).not.toBe('done');

    // Re-stamp the land leaf done
    await completeTodo(repo, land.id, 'accepted');

    // Second sweep at baseTime + 50_000 (inside the 90s window) should be throttled
    const report2 = buildEpicBranchStatus(listTodos(repo, { includeCompleted: true }), probe);
    const reopened2 = await sweepCorruptEpics(repo, { report: report2, now: baseTime + 50_000 });
    expect(reopened2).toEqual([]); // throttled, returns empty
    expect(getTodo(repo, land.id)!.status).toBe('done'); // land leaf stays done

    // Third sweep at baseTime + 100_000 (past the 90s interval) should reopen again
    const reopened3 = await sweepCorruptEpics(repo, { report: report2, now: baseTime + 100_000 });
    expect(reopened3).toContain(land.id);
    expect(getTodo(repo, land.id)!.status).not.toBe('done');

    // Re-stamp the land leaf done again
    await completeTodo(repo, land.id, 'accepted');

    // Fourth sweep with force:true should bypass the throttle even within the new window
    const reopened4 = await sweepCorruptEpics(repo, {
      report: report2,
      force: true,
      now: baseTime + 100_001,
    });
    expect(reopened4).toContain(land.id); // force bypasses throttle
    expect(getTodo(repo, land.id)!.status).not.toBe('done');
  });
});
