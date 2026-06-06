// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSupervisorRoutes } from '../supervisor-routes';
import { createTodo, _closeProject as closeTodos } from '../../services/todo-store';
import { listEdges } from '../../services/system-object-edges';
import { _closeProject as closeObjects } from '../../services/system-object-store';

let project: string;

beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'sat-edge-')); });
afterEach(() => {
  closeTodos(project);
  closeObjects(project);
  rmSync(project, { recursive: true, force: true });
});

async function postSatisfy(body: unknown): Promise<Response | null> {
  const req = new Request('http://x/api/supervisor/edges/satisfy', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return handleSupervisorRoutes(req, new URL(req.url));
}

describe('POST /api/supervisor/edges/satisfy', () => {
  test('explicit objectId → object→req satisfy edge', async () => {
    const res = await postSatisfy({ project, objectId: 'obj-1', reqId: 'req-1' });
    expect(res?.status).toBe(200);
    const edges = listEdges(project, { kind: 'satisfy' });
    expect(edges).toHaveLength(1);
    expect(edges[0].srcId).toBe('obj-1'); // object is the source
    expect(edges[0].dstId).toBe('req-1'); // requirement is the dest
  });

  test('resolves the object via the dragged todo objectRef', async () => {
    const todo = await createTodo(project, { ownerSession: 's', title: 'linked', objectRef: 'obj-7' });
    const res = await postSatisfy({ project, todoId: todo.id, reqId: 'req-2' });
    expect(res?.status).toBe(200);
    const edges = listEdges(project, { kind: 'satisfy' });
    expect(edges.find((e) => e.srcId === 'obj-7' && e.dstId === 'req-2')).toBeTruthy();
  });

  test('a todo with NO objectRef is rejected gracefully (422), no edge created', async () => {
    const todo = await createTodo(project, { ownerSession: 's', title: 'unlinked' }); // objectRef null
    const res = await postSatisfy({ project, todoId: todo.id, reqId: 'req-3' });
    expect(res?.status).toBe(422);
    expect(listEdges(project, { kind: 'satisfy' })).toHaveLength(0);
  });

  test('missing project/reqId → 400', async () => {
    const res = await postSatisfy({ objectId: 'obj-1' });
    expect(res?.status).toBe(400);
  });
});
