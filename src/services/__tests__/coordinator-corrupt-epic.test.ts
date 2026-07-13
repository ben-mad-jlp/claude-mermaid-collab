import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-corrupt-sup-'));

import { sweepCorruptEpics } from '../coordinator-live';
import { buildEpicBranchStatus, type BranchProbe, type GitProbe } from '../epic-branch-status';
import { createTodo, completeTodo, getTodo, listTodos } from '../todo-store';

const probeWith = (facts: Record<string, BranchProbe>): GitProbe =>
  (branch) => facts[branch] ?? { exists: false, ahead: null, behind: null, mergeable: null };

describe('sweepCorruptEpics', () => {
  it('corrupt (land done + ahead>0): report flags corrupt AND sweep reopens the land leaf', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-corrupt-repo-'));
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', kind: 'epic', status: 'planned' });
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted'); // FALSELY stamp the land leaf done

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true } }),
    );
    const e = report.epics.find((x) => x.epicId === epic.id)!;
    expect(e.stranded).toBe(true);
    expect(e.corrupt).toBe(true);
    expect(report.corruptCount).toBe(1);

    const reopened = await sweepCorruptEpics(repo, { report });
    expect(reopened).toContain(land.id);
    expect(getTodo(repo, land.id)!.status).not.toBe('done'); // stamp reverted → ready
  });

  it('clean (land done + ahead==0): NOT corrupt, land leaf NOT reopened', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-clean-repo-'));
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] clean', kind: 'epic', status: 'planned' });
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] clean → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 0, behind: 0, mergeable: true } }),
    );
    const e = report.epics.find((x) => x.epicId === epic.id)!;
    expect(e.stranded).toBe(false);
    expect(e.corrupt).toBe(false);

    const reopened = await sweepCorruptEpics(repo, { report });
    expect(reopened).not.toContain(land.id);
    expect(getTodo(repo, land.id)!.status).toBe('done'); // untouched
  });
});
