import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-diagnostic-route-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { createTodo, _closeProject } from '../../services/todo-store';
import { upsertMission, addCriterion } from '../../services/mission-store';
import { handleSupervisorRoutes } from '../supervisor-routes';

let project: string;
let missionId = '';

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'mission-diagnostic-route-'));
  const m = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: 'Mission: converge',
    kind: 'mission',
  });
  upsertMission(project, m.id);
  addCriterion(project, m.id, 'the capability under test');
  missionId = m.id;
});

afterAll(() => {
  _closeProject(project);
  _closeProject(SUP_DIR);
  rmSync(project, { recursive: true, force: true });
  rmSync(SUP_DIR, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

async function getDiagnostic(query: string): Promise<{ status: number; body: any }> {
  const req = new Request(`http://x/api/supervisor/missions/diagnostic?${query}`);
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return { status: res!.status, body: await res!.json() };
}

describe('GET /api/supervisor/missions/diagnostic', () => {
  test('returns 200 with status, rollup, criteria, leaves, conductorPass, baseHealth', async () => {
    const { status, body } = await getDiagnostic(`project=${encodeURIComponent(project)}&missionId=${missionId}`);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      ['baseHealth', 'conductorPass', 'criteria', 'hostLoad', 'leaves', 'rollup', 'status'].sort(),
    );
  });

  test('without missionId returns 400', async () => {
    const { status } = await getDiagnostic(`project=${encodeURIComponent(project)}`);
    expect(status).toBe(400);
  });

  test('a non-path project value is rejected, not silently resolved against server cwd', async () => {
    const { status, body } = await getDiagnostic(`project=not-a-real-registered-name&missionId=${missionId}`);
    expect(status).not.toBe(200);
    expect(JSON.stringify(body)).toMatch(/not-a-real-registered-name/);
  });
});
