// Route test for GET /api/conductor/journal — isolates the journal DB via
// MERMAID_SUPERVISOR_DIR before import.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'conductor-journal-route-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleConductorRoutes } from '../conductor-routes.js';
import {
  openPassRow,
  finalizePassRow,
  _closeConductorJournalDb,
} from '../../services/conductor-pass-journal.js';

const PROJECT = '/tmp/conductor-journal-route-proj';

function seed(missionId: string, startedAt: number, outcome: string): void {
  const id = openPassRow(PROJECT, missionId, startedAt);
  expect(id).not.toBeNull();
  finalizePassRow(id!, { endedAt: startedAt + 1000, outcome, ran: true });
}

async function get(query: string): Promise<Response> {
  const url = new URL(`http://localhost:9002/api/conductor/journal${query}`);
  const res = await handleConductorRoutes(new Request(url.toString(), { method: 'GET' }), url);
  expect(res).not.toBeNull();
  return res!;
}

beforeAll(() => {
  _closeConductorJournalDb();
  seed('m1', 1000, 'conducted');
  seed('m1', 3000, 'debounced');
  seed('m2', 2000, 'conducted');
});

afterAll(() => {
  _closeConductorJournalDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('GET /api/conductor/journal', () => {
  it('returns rows newest-first', async () => {
    const res = await get(`?project=${encodeURIComponent(PROJECT)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: string; rows: Array<{ startedAt: number }> };
    expect(body.project).toBe(PROJECT);
    expect(body.rows.map((r) => r.startedAt)).toEqual([3000, 2000, 1000]);
  });

  it('filters by missionId', async () => {
    const res = await get(`?project=${encodeURIComponent(PROJECT)}&missionId=m1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ missionId: string; startedAt: number }> };
    expect(body.rows.map((r) => r.missionId)).toEqual(['m1', 'm1']);
    expect(body.rows.map((r) => r.startedAt)).toEqual([3000, 1000]);
  });

  it('truncates results with limit', async () => {
    const res = await get(`?project=${encodeURIComponent(PROJECT)}&limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ startedAt: number }> };
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((r) => r.startedAt)).toEqual([3000, 2000]);
  });

  it('400s when project is missing', async () => {
    const res = await get('');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project is required');
  });
});
