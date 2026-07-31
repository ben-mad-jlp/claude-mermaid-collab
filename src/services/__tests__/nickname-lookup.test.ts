// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import { addCriterion, _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { nicknamesForProject } from '../nickname-lookup';
import {
  openPassRow,
  finalizePassRow,
  listConductorPasses,
  _closeConductorJournalDb,
} from '../conductor-pass-journal';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'nickname-lookup-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeConductorJournalDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('nickname-lookup', () => {
  test('nicknamesForProject merges todo and criterion nicknames', async () => {
    const missionId = await makeMissionNode();
    const criterion = addCriterion(project, missionId, 'Some multi word title');

    const nicknames = nicknamesForProject(project);

    expect(nicknames[missionId]).toBeTruthy();
    expect(nicknames[criterion.id]).toBe(criterion.nickname);
  });

  test('GET /api/conductor/journal returns unchanged rows alongside nicknames', async () => {
    const missionId = await makeMissionNode();
    const passId = openPassRow(project, missionId, 1000);
    expect(passId).not.toBeNull();
    finalizePassRow(passId!, { endedAt: 2000, outcome: 'conducted', ran: true });

    const rowsBefore = listConductorPasses(project, { missionId });

    const { handleConductorRoutes } = await import('../../routes/conductor-routes.js');
    const url = new URL(
      `http://localhost:9002/api/conductor/journal?project=${encodeURIComponent(project)}&missionId=${missionId}`,
    );
    const res = await handleConductorRoutes(new Request(url.toString(), { method: 'GET' }), url);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      rows: typeof rowsBefore;
      nicknames: Record<string, string>;
    };

    expect(body.rows).toEqual(rowsBefore);
    expect(body.nicknames[missionId]).toBeTruthy();
  });
});
