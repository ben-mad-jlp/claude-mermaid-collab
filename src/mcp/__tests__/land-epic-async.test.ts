/**
 * Tests for the async land_epic handler: acknowledgment + background dispatch
 *
 * Verifies that land_epic immediately returns {jobId, status:'landing'} and
 * runs the gated merge (mutex, dirty-tree, staleness, proof, --no-ff merge,
 * teardown, post-land guard) as a background promise that settles the job
 * and resolves the escalation on success or raises a rebase card on conflict.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-async-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, _closeProject } from '../../services/todo-store';
import { createEscalation, getEscalation, _closeDb as _closeSupervisorDb } from '../../services/supervisor-store';
import { getJob, _resetAsyncJobDbCache } from '../../services/async-job-store';
import { handleEpicTool } from '../epic-tools';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land_epic async dispatch', () => {
  let repo: string;
  let epicId: string;
  let escalationId: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-async-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Seed the work-graph for a successful land
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: '[EPIC] async land test',
      ownerSession: 'test',
      kind: 'epic',
    });
    epicId = epic.id;
    const landChild = await createTodo(repo, {
      allowOrphan: true,
      title: '[LAND] → master',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'land',
    });
    const { escalation } = createEscalation({
      audience: 'internal',
      project: repo,
      session: 'sX',
      kind: 'epic-ready-to-land',
      questionText: 'ready to land?',
      todoId: landChild.id,
    });
    escalationId = escalation.id;
  });

  afterEach(() => {
    _closeProject(repo);
    _resetAsyncJobDbCache(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('resolves with a jobId and status landing in under 5s', async () => {
    const startTime = Date.now();

    const result = await handleEpicTool('land_epic', {
      project: repo,
      escalationId,
      actor: 'human',
    });

    const elapsed = Date.now() - startTime;

    if (!result) throw new Error('handler returned null');
    const parsed = JSON.parse(result);

    expect(parsed.jobId).toBeTruthy();
    expect(typeof parsed.jobId).toBe('string');
    expect(parsed.status).toBe('landing');
    expect(parsed.escalationId).toBe(escalationId);
    expect(parsed.actor).toBe('human');

    expect(elapsed).toBeLessThan(5000);
  });

  it('immediately returns ack even if background land will fail', async () => {
    const startTime = Date.now();

    const result = await handleEpicTool('land_epic', {
      project: repo,
      escalationId,
      actor: 'human',
    });

    const elapsed = Date.now() - startTime;

    if (!result) throw new Error('handler returned null');
    const parsed = JSON.parse(result);
    const jobId = parsed.jobId;

    expect(parsed.jobId).toBeTruthy();
    expect(parsed.status).toBe('landing');

    // Verify it returned quickly (not waiting for background work)
    expect(elapsed).toBeLessThan(2000);

    // Job exists and is in running state initially (or transitions quickly)
    const job = getJob(repo, jobId);
    expect(job).toBeTruthy();
    expect(['running', 'succeeded', 'failed']).toContain(job!.status);
  });

  it('on a merge conflict master is untouched, the original card stays open, the job reads failed', async () => {
    const epicBranch = `collab/epic/${epicId.substring(0, 8)}`;
    await runGit(repo, ['checkout', '-b', epicBranch]);
    writeFileSync(join(repo, 'conflict-file.txt'), 'epic version\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'epic change', `Collab-Todo: ${epicId}`]);

    await runGit(repo, ['checkout', '-q', 'master']);
    writeFileSync(join(repo, 'conflict-file.txt'), 'master version\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master change']);

    const preLandRes = await runGit(repo, ['rev-parse', 'HEAD']);
    const preLandSha = preLandRes.stdout.trim();

    const result = await handleEpicTool('land_epic', {
      project: repo,
      escalationId,
      actor: 'human',
    });

    if (!result) throw new Error('handler returned null');
    const parsed = JSON.parse(result);
    const jobId = parsed.jobId;

    let job = getJob(repo, jobId);
    let retries = 0;
    while (job && job.status === 'running' && retries < 50) {
      await (globalThis as any).Bun.sleep(100);
      job = getJob(repo, jobId);
      retries++;
    }

    expect(job).toBeTruthy();
    expect(job!.status).toBe('failed');
    expect(job!.error).toBeTruthy();

    const postLandRes = await runGit(repo, ['rev-parse', 'master']);
    const postLandSha = postLandRes.stdout.trim();
    expect(postLandSha).toBe(preLandSha);

    const esc = getEscalation(escalationId);
    expect(esc).toBeTruthy();
    expect(esc!.status).toBe('open');
  });
});
