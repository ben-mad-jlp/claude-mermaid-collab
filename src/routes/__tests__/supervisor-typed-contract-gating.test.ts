import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the GLOBAL supervisor.db so addWatchedProject below never leaks a phantom watched
// project into the live ~/.mermaid-collab. The store opens lazily, so set env before first call.
const dir = mkdtempSync(join(tmpdir(), 'typed-gating-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_DATA_DIR = dir;

import { handleSupervisorRoutes } from '../supervisor-routes';
import { addWatchedProject, _closeDb as supervisorCloseDb } from '../../services/supervisor-store';

afterAll(() => {
  supervisorCloseDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_DATA_DIR;
});

async function get(project?: string) {
  const qs = project === undefined ? '' : `?project=${encodeURIComponent(project)}`;
  const req = new Request(`http://x/api/supervisor/typed-contract-gating${qs}`, { method: 'GET' });
  return handleSupervisorRoutes(req, new URL(req.url));
}
async function post(body: unknown) {
  const req = new Request('http://x/api/supervisor/typed-contract-gating', { method: 'POST', body: JSON.stringify(body) });
  return handleSupervisorRoutes(req, new URL(req.url));
}

describe('GET/POST /api/supervisor/typed-contract-gating', () => {
  test('GET without project → 400', async () => {
    expect((await get())?.status).toBe(400);
  });

  test('GET defaults to enabled:false for a fresh project', async () => {
    const res = await get('/tmp/tcg-p');
    expect(res?.status).toBe(200);
    expect(((await res!.json()) as any).enabled).toBe(false);
  });

  test('POST toggles the flag and echoes it back (UPDATE-only ⇒ project must be watched)', async () => {
    const project = '/tmp/tcg-toggle-p';
    addWatchedProject(project);
    const on = await post({ project, enabled: true });
    expect(on?.status).toBe(200);
    expect(((await on!.json()) as any).enabled).toBe(true);

    const readBack = await get(project);
    expect(((await readBack!.json()) as any).enabled).toBe(true);

    const off = await post({ project, enabled: false });
    expect(((await off!.json()) as any).enabled).toBe(false);
  });

  test('POST with a non-boolean enabled → 400', async () => {
    expect((await post({ project: '/tmp/tcg-p', enabled: 'yes' }))?.status).toBe(400);
  });

  test('POST without project → 400', async () => {
    expect((await post({ enabled: true }))?.status).toBe(400);
  });
});
