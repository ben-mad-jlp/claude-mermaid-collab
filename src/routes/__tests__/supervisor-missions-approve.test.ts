import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-approve-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

// Imports AFTER the env is set so any db opens against our temp dir.
import { forgeMissionFromDoc } from '../../mcp/tools/mission-forge';
import { getMission, _resetMissionDbCache } from '../../services/mission-store';
import { handleSupervisorRoutes } from '../supervisor-routes';

const mockDeps = () => ({
  readDoc: async () => 'doc text',
  invoke: async () => ({
    ok: true,
    rateLimited: false,
    text: '```json\n' + JSON.stringify({ title: 'T', criteria: ['c1'] }) + '\n```',
  } as any),
});

async function post(body: unknown) {
  const req = new Request('http://x/api/supervisor/missions/approve', { method: 'POST', body: JSON.stringify(body) });
  return handleSupervisorRoutes(req, new URL(req.url));
}

describe('POST /api/supervisor/missions/approve', () => {
  let project: string;

  afterEach(() => {
    if (project) {
      _resetMissionDbCache(project);
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('approves a forged unapproved mission', async () => {
    project = mkdtempSync(join(tmpdir(), 'mission-approve-'));
    const r = await forgeMissionFromDoc(project, { session: 's1', docId: 'd1' }, mockDeps());
    expect(getMission(project, r.missionId)?.status).toBe('unapproved');

    const res = await post({ project, todoId: r.missionId });
    expect(res?.status).toBe(200);

    expect(getMission(project, r.missionId)?.status).not.toBe('unapproved');
  });

  test('missing todoId → 400', async () => {
    project = mkdtempSync(join(tmpdir(), 'mission-approve-'));
    const res = await post({ project });
    expect(res?.status).toBe(400);
  });
});
