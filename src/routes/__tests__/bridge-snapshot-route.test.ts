import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'bridge-snapshot-route-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { createTodo, _closeProject } from '../../services/todo-store';
import { handleSupervisorRoutes } from '../supervisor-routes';

let project: string;

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'bridge-snapshot-route-'));
  await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: 'Test todo',
    kind: 'leaf',
  });
});

afterAll(() => {
  _closeProject(project);
  _closeProject(SUP_DIR);
  rmSync(project, { recursive: true, force: true });
  rmSync(SUP_DIR, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

async function getSnapshot(query: string): Promise<{ status: number; body: any }> {
  const req = new Request(`http://x/api/supervisor/bridge-snapshot?${query}`);
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return { status: res!.status, body: await res!.json() };
}

describe('GET /api/supervisor/bridge-snapshot', () => {
  test('returns 200 with the six snapshot keys', async () => {
    const { status, body } = await getSnapshot(`project=${encodeURIComponent(project)}`);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      ['coverage', 'missions', 'openEscalations', 'projects', 'summaries', 'todos'].sort(),
    );
  });

  test('without project returns 400', async () => {
    const { status } = await getSnapshot('');
    expect(status).toBe(400);
  });
});
