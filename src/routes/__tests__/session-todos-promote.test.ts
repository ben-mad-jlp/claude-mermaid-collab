import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAPI } from '../api';
import { createTodo, getTodo, _closeProject } from '../../services/todo-store';
import { ensureBucket } from '../../services/bucket-registry';

const ws = { broadcast() {} } as any;
async function post(body: unknown): Promise<Response> {
  const req = new Request('http://x/api/session-todos/promote-to-epic', {
    method: 'POST', body: JSON.stringify(body),
  });
  return handleAPI(req, null as any, null as any, null as any, null as any, null as any, ws, new URL(req.url));
}

let project: string;
afterEach(() => { if (project) { _closeProject(project); rmSync(project, { recursive: true, force: true }); } });

describe('POST /api/session-todos/promote-to-epic', () => {
  test('promotes a bucket item → { epic, item }, item done + promotedTo', async () => {
    project = mkdtempSync(join(tmpdir(), 'promote-route-'));
    const bucket = await ensureBucket(project, 'inbox');
    const item = await createTodo(project, { ownerSession: 's', title: 'raw idea', parentId: bucket });
    const res = await post({ project, id: item.id });
    expect(res.status).toBe(200);
    const result = await res.json() as { epic: any; item: any };
    expect(result.epic.kind).toBe('epic');
    expect(result.item.promotedTo).toBe(result.epic.id);
    const stored = getTodo(project, item.id);
    expect(stored?.status).toBe('done');
    expect(stored?.promotedTo).toBe(result.epic.id);
  });
  test('missing project or id → 400', async () => {
    project = mkdtempSync(join(tmpdir(), 'promote-route-'));
    expect((await post({ id: 'x' })).status).toBe(400);
    expect((await post({ project })).status).toBe(400);
  });
});
