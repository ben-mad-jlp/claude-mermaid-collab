import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'land-jobs-route-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { createJob, markJobRunning, markJobSucceeded, _resetAsyncJobDbCache } from '../../services/async-job-store';
import { handleSupervisorRoutes } from '../supervisor-routes';

let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'land-jobs-route-'));
});

afterAll(() => {
  _resetAsyncJobDbCache(project);
  rmSync(project, { recursive: true, force: true });
  rmSync(SUP_DIR, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

async function getLandJobs(query: string): Promise<{ status: number; body: any }> {
  const req = new Request(`http://x/api/supervisor/land-jobs?${query}`);
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return { status: res!.status, body: await res!.json() };
}

describe('GET /api/supervisor/land-jobs', () => {
  test('returns running land-epic jobs and omits succeeded ones', async () => {
    const runningJob = createJob(project, {
      kind: 'land-epic',
      targetId: 'epic-123',
    });
    markJobRunning(project, runningJob.id);

    const succeededJob = createJob(project, {
      kind: 'land-epic',
      targetId: 'epic-456',
    });
    markJobSucceeded(project, succeededJob.id);

    const { status, body } = await getLandJobs(`project=${encodeURIComponent(project)}`);
    expect(status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]!.id).toBe(runningJob.id);
    expect(body.jobs[0]!.targetId).toBe('epic-123');
    expect(body.jobs[0]!.status).toBe('running');
    expect(typeof body.jobs[0]!.phase).toBe('object'); // null is an object in JSON
    expect(typeof body.jobs[0]!.updatedAt).toBe('number');
    expect(body.jobs[0]!.resultJson).toBeUndefined();
    expect(body.jobs[0]!.error).toBeUndefined();
    expect(body.jobs[0]!.bootId).toBeUndefined();
    expect(body.jobs[0]!.pid).toBeUndefined();
  });

  test('without project returns 400', async () => {
    const { status, body } = await getLandJobs('');
    expect(status).toBe(400);
    expect(body.error).toBe('project is required');
  });
});
