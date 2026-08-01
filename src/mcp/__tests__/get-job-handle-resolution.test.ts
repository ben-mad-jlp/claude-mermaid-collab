/**
 * Tests for handleSystemTool('get_job', ...) resolution of async-job producers.
 *
 * Verifies that both land_epic and forge_mission_from_doc hand out a jobId that
 * handleSystemTool('get_job', ...) resolves to a terminal status (not by calling
 * getJob from async-job-store.ts directly, but through the MCP handler).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'get-job-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, _closeProject } from '../../services/todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../../services/supervisor-store';
import { _resetAsyncJobDbCache } from '../../services/async-job-store';
import { handleEpicTool } from '../epic-tools';
import { handleSystemTool } from '../system-tools';
import { forgeMissionFromDoc } from '../tools/mission-forge';

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

beforeAll(() => {
  _closeSupervisorDb();
});

afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('handleSystemTool get_job resolution', () => {
  describe('Case A: land_epic producer', () => {
    let repo: string;
    let epicId: string;
    let escalationId: string;

    beforeEach(async () => {
      repo = mkdtempSync(join(tmpdir(), 'get-job-land-'));
      await runGit(repo, ['init', '-q', '-b', 'master']);
      await runGit(repo, ['config', 'user.email', 't@t']);
      await runGit(repo, ['config', 'user.name', 'T']);
      writeFileSync(join(repo, 'base.txt'), 'base\n');
      await runGit(repo, ['add', '-A']);
      await runGit(repo, ['commit', '-q', '-m', 'base']);

      // Seed the work-graph for a successful land
      const epic = await createTodo(repo, {
        allowOrphan: true,
        title: '[EPIC] get-job test',
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

    it('land_epic jobId resolves to a terminal status via get_job', async () => {
      const result = await handleEpicTool('land_epic', {
        project: repo,
        escalationId,
        actor: 'human',
      });

      if (!result) throw new Error('land_epic handler returned null');
      const parsed = JSON.parse(result);
      const jobId = parsed.jobId;

      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');

      // Poll handleSystemTool('get_job', ...) until terminal
      let job: any = null;
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts) {
        const jobResult = await handleSystemTool('get_job', { project: repo, jobId });
        expect(jobResult).toBeTruthy();
        job = JSON.parse(jobResult!);

        if (job.status === 'succeeded' || job.status === 'failed') {
          break;
        }

        await (globalThis as any).Bun.sleep(100);
        attempts++;
      }

      expect(job).toBeTruthy();
      expect(job.status).toMatch(/^(succeeded|failed)$/);
      expect(typeof job.error === 'string' || job.error === null).toBe(true);
    });
  });

  describe('Case B: forge_mission_from_doc producer', () => {
    let project: string;

    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), 'get-job-forge-'));
    });

    afterEach(() => {
      _resetAsyncJobDbCache(project);
      try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('forge_mission_from_doc jobId resolves to a terminal status via get_job', async () => {
      const SPEC = {
        title: 'Test forge mission',
        description: 'A test mission forged from a doc.',
        criteria: ['criterion one', 'criterion two'],
        constraints: [{ rule: 'the mechanical gate stays PRE-land', rationale: 'placebo-hole guarantee' }],
        rejectedAlternatives: [{ title: 'arbiter LLM', rationale: 'Grok killed it', alternatives: ['second LLM judge'] }],
        digest: '# Test Digest\n- some fact',
      };

      const mockDeps = {
        readDoc: async () => 'PROBLEM: test the forge producer.',
        invoke: async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(SPEC) + '\n```' } as any),
      };

      const ack = await forgeMissionFromDoc(project, { session: 's1', docId: 'd' }, mockDeps);

      expect(ack.status).toBe('forging');
      expect(ack.jobId).toBeTruthy();
      expect(typeof ack.jobId).toBe('string');
      expect(ack.missionId).toBeTruthy();

      // Poll handleSystemTool('get_job', ...) until terminal
      let job: any = null;
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts) {
        const jobResult = await handleSystemTool('get_job', { project, jobId: ack.jobId });
        expect(jobResult).toBeTruthy();
        job = JSON.parse(jobResult!);

        if (job.status === 'succeeded' || job.status === 'failed') {
          break;
        }

        await (globalThis as any).Bun.sleep(100);
        attempts++;
      }

      expect(job).toBeTruthy();
      expect(job.status).toMatch(/^(succeeded|failed)$/);
      expect(typeof job.error === 'string' || job.error === null).toBe(true);
    });
  });

  describe('Case C: not-found shape', () => {
    let repo: string;

    beforeEach(async () => {
      repo = mkdtempSync(join(tmpdir(), 'get-job-notfound-'));
      await runGit(repo, ['init', '-q', '-b', 'master']);
      await runGit(repo, ['config', 'user.email', 't@t']);
      await runGit(repo, ['config', 'user.name', 'T']);
      writeFileSync(join(repo, 'base.txt'), 'base\n');
      await runGit(repo, ['add', '-A']);
      await runGit(repo, ['commit', '-q', '-m', 'base']);
    });

    afterEach(() => {
      _closeProject(repo);
      try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('get_job with an unknown jobId returns found:false', async () => {
      const randomJobId = randomUUID();
      const result = await handleSystemTool('get_job', { project: repo, jobId: randomJobId });

      expect(result).toBeTruthy();
      const parsed = JSON.parse(result!);

      expect(parsed.found).toBe(false);
      expect(parsed.status).toBeNull();
      expect(parsed.jobId).toBe(randomJobId);
    });
  });
});
