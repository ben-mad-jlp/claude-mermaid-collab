/**
 * Unit tests for the conductor targetMissionId round-trip in
 * src/routes/supervisor-routes.ts (handleSupervisorRoutes).
 * Isolates the supervisor-store DB via MERMAID_SUPERVISOR_DIR before import.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'conductor-target-routes-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleSupervisorRoutes } from '../supervisor-routes';
import { addWatchedProject, _closeDb as supervisorCloseDb } from '../../services/supervisor-store';

const PROJECT = '/tmp/conductor-target-routes-proj';

function call(method: string, path: string, body?: unknown): Promise<Response | null> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const req = new Request(`http://localhost:9002${path}`, init);
  return handleSupervisorRoutes(req, new URL(req.url));
}

beforeAll(() => {
  supervisorCloseDb();
});
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  supervisorCloseDb();
  addWatchedProject(PROJECT);
});
afterAll(() => {
  supervisorCloseDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('conductor targetMissionId round-trip', () => {
  it('POST targetMissionId then GET returns it', async () => {
    const post = await call('POST', '/api/supervisor/conductor', { project: PROJECT, targetMissionId: 'm1' });
    expect(post!.status).toBe(200);
    expect((await post!.json() as any).targetMissionId).toBe('m1');

    const get = await call('GET', `/api/supervisor/conductor?project=${encodeURIComponent(PROJECT)}`);
    expect((await get!.json() as any).targetMissionId).toBe('m1');
  });

  it('POST targetMissionId null clears the pin', async () => {
    await call('POST', '/api/supervisor/conductor', { project: PROJECT, targetMissionId: 'm1' });
    const post = await call('POST', '/api/supervisor/conductor', { project: PROJECT, targetMissionId: null });
    expect(post!.status).toBe(200);
    expect((await post!.json() as any).targetMissionId).toBeNull();

    const get = await call('GET', `/api/supervisor/conductor?project=${encodeURIComponent(PROJECT)}`);
    expect((await get!.json() as any).targetMissionId).toBeNull();
  });

  it('POST enabled alone does not clear an existing targetMissionId pin', async () => {
    await call('POST', '/api/supervisor/conductor', { project: PROJECT, targetMissionId: 'm1' });
    const post = await call('POST', '/api/supervisor/conductor', { project: PROJECT, enabled: true });
    expect(post!.status).toBe(200);
    expect((await post!.json() as any).targetMissionId).toBe('m1');

    const get = await call('GET', `/api/supervisor/conductor?project=${encodeURIComponent(PROJECT)}`);
    const getBody = (await get!.json()) as any;
    expect(getBody.targetMissionId).toBe('m1');
    expect(getBody.enabled).toBe(true);
  });

  it('POST requires project', async () => {
    const res = await call('POST', '/api/supervisor/conductor', { targetMissionId: 'm1' });
    expect(res!.status).toBe(400);
  });

  it('POST with neither enabled nor targetMissionId is a 400', async () => {
    const res = await call('POST', '/api/supervisor/conductor', { project: PROJECT });
    expect(res!.status).toBe(400);
  });
});
