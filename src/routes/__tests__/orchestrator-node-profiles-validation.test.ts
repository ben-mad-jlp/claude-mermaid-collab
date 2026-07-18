import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleOrchestratorRoutes } from '../orchestrator-routes';

describe('POST /api/orchestrator/node-profiles validation', () => {
  const testProject = '/tmp/test-project';

  describe('provider/model pair validation', () => {
    it('rejects grok-4.3 model on claude provider', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'implement',
          provider: 'claude',
          model: 'grok-4.3',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('grok-4.3');
      expect(body.error).toContain('claude');
      expect(body.error).toContain('grok-api');
    });

    it('rejects opus model on grok-api provider', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'implement',
          provider: 'grok-api',
          model: 'opus',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('opus');
      expect(body.error).toContain('grok-api');
      expect(body.error).toContain('claude');
    });

    it('rejects grok-4.3 model on grok-build provider', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'implement',
          provider: 'grok-build',
          model: 'grok-4.3',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('grok-4.3');
      expect(body.error).toContain('grok-build');
      expect(body.error).toContain('grok-api');
    });

    it('accepts valid model/provider pair', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'implement',
          provider: 'grok-build',
          model: 'grok-build-0.1',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });

    it('accepts null model (inherit)', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'implement',
          provider: 'claude',
          model: null,
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });
  });

  describe('MCP guard extension to grok-api', () => {
    it('rejects grok-api provider for MCP-forced kinds like report', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'report',
          provider: 'grok-api',
          model: 'grok-4.3',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('MCP');
    });

    it('rejects grok-build provider for MCP-forced kinds like driveexec', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({
          project: testProject,
          kind: 'driveexec',
          provider: 'grok-build',
          model: 'grok-build-0.1',
        }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('MCP');
    });
  });

  describe('orchestration kinds', () => {
    it('accepts a model+effort override for forge', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'forge', model: 'opus', effort: 'high' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });

    it('accepts a model+effort override for conductor', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'conductor', model: 'opus', effort: 'high' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });

    it('accepts a model+effort override for planner', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'planner', model: 'opus', effort: 'high' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });

    it('rejects grok-build provider for conductor (MCP-forced)', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'conductor', provider: 'grok-build', model: 'grok-build-0.1' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('MCP');
    });

    it('rejects grok-build provider for planner (MCP-forced)', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'planner', provider: 'grok-build', model: 'grok-build-0.1' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('MCP');
    });

    it('accepts grok-build provider for forge (not MCP-forced)', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'forge', provider: 'grok-build', model: 'grok-build-0.1' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(200);
    });

    it('rejects an unknown kind, listing orchestration kinds in the error', async () => {
      const req = new Request('http://localhost/api/orchestrator/node-profiles', {
        method: 'POST',
        body: JSON.stringify({ project: testProject, kind: 'bogus' }),
      });
      const res = await handleOrchestratorRoutes(req, new URL(req.url));
      expect(res?.status).toBe(400);
      const body = await res?.json() as Record<string, unknown>;
      expect(body.error).toContain('forge');
      expect(body.error).toContain('conductor');
      expect(body.error).toContain('planner');
    });
  });
});
