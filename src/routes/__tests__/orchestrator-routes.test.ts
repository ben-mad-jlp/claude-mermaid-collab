/**
 * Unit tests for src/routes/orchestrator-routes.ts (handleOrchestratorRoutes).
 * Isolates the orchestrator-config DB via MERMAID_SUPERVISOR_DIR before import.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'orch-routes-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleOrchestratorRoutes } from '../orchestrator-routes';
import { _closeDb } from '../../services/orchestrator-config';

const PROJECT = '/tmp/orch-routes-proj';

function call(method: string, path: string, body?: unknown): Promise<Response | null> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const req = new Request(`http://localhost:9002${path}`, init);
  return handleOrchestratorRoutes(req, new URL(req.url));
}

beforeAll(() => { _closeDb(); });
beforeEach(() => { process.env.MERMAID_SUPERVISOR_DIR = dir; _closeDb(); });
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('handleOrchestratorRoutes', () => {
  it('GET level defaults to build for an unset project', async () => {
    const res = await call('GET', `/api/orchestrator/level?project=${encodeURIComponent(PROJECT)}`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ project: PROJECT, level: 'build' });
  });

  it('GET level requires project', async () => {
    const res = await call('GET', '/api/orchestrator/level');
    expect(res!.status).toBe(400);
  });

  it('POST level persists and GET reads it back', async () => {
    const post = await call('POST', '/api/orchestrator/level', { project: PROJECT, level: 'nudge' });
    expect(post!.status).toBe(200);
    expect(await post!.json()).toEqual({ project: PROJECT, level: 'nudge' });

    const get = await call('GET', `/api/orchestrator/level?project=${encodeURIComponent(PROJECT)}`);
    expect(await get!.json()).toEqual({ project: PROJECT, level: 'nudge' });
  });

  it('POST level rejects an invalid level', async () => {
    const res = await call('POST', '/api/orchestrator/level', { project: PROJECT, level: 'bogus' });
    expect(res!.status).toBe(400);
  });

  it('POST level requires project', async () => {
    const res = await call('POST', '/api/orchestrator/level', { level: 'build' });
    expect(res!.status).toBe(400);
  });

  it('GET health returns a status object', async () => {
    const res = await call('GET', '/api/orchestrator/health');
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { running: boolean };
    expect(typeof body.running).toBe('boolean');
  });

  it('returns null for an unmatched path', async () => {
    const res = await call('GET', '/api/orchestrator/unknown');
    expect(res).toBeNull();
  });
});
