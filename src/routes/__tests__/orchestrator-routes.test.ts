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
import { LEAF_NODE_KINDS } from '../../services/leaf-executor';
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
  it('GET level defaults to on for an unset project', async () => {
    const res = await call('GET', `/api/orchestrator/level?project=${encodeURIComponent(PROJECT)}`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ project: PROJECT, level: 'on' });
  });

  it('GET level requires project', async () => {
    const res = await call('GET', '/api/orchestrator/level');
    expect(res!.status).toBe(400);
  });

  it('POST level persists and GET reads it back', async () => {
    // Use a non-default level ('auto') so the round-trip proves persistence (the
    // unset default is 'on').
    const post = await call('POST', '/api/orchestrator/level', { project: PROJECT, level: 'auto' });
    expect(post!.status).toBe(200);
    expect(await post!.json()).toEqual({ project: PROJECT, level: 'auto' });

    const get = await call('GET', `/api/orchestrator/level?project=${encodeURIComponent(PROJECT)}`);
    expect(await get!.json()).toEqual({ project: PROJECT, level: 'auto' });
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

describe('handleOrchestratorRoutes — pool-size', () => {
  const POOL_PROJECT = '/tmp/orch-routes-pool';

  it('GET defaults to null (inherit) and surfaces default + max', async () => {
    const res = await call('GET', `/api/orchestrator/pool-size?project=${encodeURIComponent(POOL_PROJECT)}`);
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    expect(body.poolSize).toBeNull();
    expect(typeof body.default).toBe('number');
    expect(typeof body.max).toBe('number');
  });

  it('POST persists a clamped size and GET reads it back', async () => {
    const post = await call('POST', '/api/orchestrator/pool-size', { project: POOL_PROJECT, poolSize: 999 });
    expect(post!.status).toBe(200);
    const posted = await post!.json() as any;
    expect(posted.poolSize).toBe(posted.max); // clamped to max
    const get = await call('GET', `/api/orchestrator/pool-size?project=${encodeURIComponent(POOL_PROJECT)}`);
    expect(((await get!.json()) as any).poolSize).toBe(posted.max);
  });

  it('POST null clears the override', async () => {
    await call('POST', '/api/orchestrator/pool-size', { project: POOL_PROJECT, poolSize: 5 });
    const cleared = await call('POST', '/api/orchestrator/pool-size', { project: POOL_PROJECT, poolSize: null });
    expect(((await cleared!.json()) as any).poolSize).toBeNull();
  });

  it('POST without project → 400', async () => {
    const res = await call('POST', '/api/orchestrator/pool-size', { poolSize: 4 });
    expect(res!.status).toBe(400);
  });
});

describe('handleOrchestratorRoutes — effort', () => {
  const EFFORT_PROJECT = '/tmp/orch-routes-effort';

  it('GET defaults to null (auto) and surfaces the level scale', async () => {
    const res = await call('GET', `/api/orchestrator/effort?project=${encodeURIComponent(EFFORT_PROJECT)}`);
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    expect(body.effort).toBeNull();
    expect(body.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('POST persists a valid level and GET reads it back', async () => {
    const post = await call('POST', '/api/orchestrator/effort', { project: EFFORT_PROJECT, effort: 'xhigh' });
    expect(post!.status).toBe(200);
    expect((await post!.json() as any).effort).toBe('xhigh');
    const get = await call('GET', `/api/orchestrator/effort?project=${encodeURIComponent(EFFORT_PROJECT)}`);
    expect(((await get!.json()) as any).effort).toBe('xhigh');
  });

  it('POST null clears the override (→ auto)', async () => {
    await call('POST', '/api/orchestrator/effort', { project: EFFORT_PROJECT, effort: 'high' });
    const cleared = await call('POST', '/api/orchestrator/effort', { project: EFFORT_PROJECT, effort: null });
    expect(((await cleared!.json()) as any).effort).toBeNull();
  });

  it('POST an invalid level → 400', async () => {
    const res = await call('POST', '/api/orchestrator/effort', { project: EFFORT_PROJECT, effort: 'turbo' });
    expect(res!.status).toBe(400);
  });
});

describe('handleOrchestratorRoutes — node-profiles', () => {
  const NP_PROJECT = '/tmp/orch-routes-np';

  it('GET returns a row per node kind with defaults + choice lists', async () => {
    const res = await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(NP_PROJECT)}`);
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBe(LEAF_NODE_KINDS.length);
    const bp = body.rows.find((r: any) => r.kind === 'blueprint');
    expect(bp.defaultModel).toBe('opus');
    expect(bp.defaultEffort).toBe('high');
    expect(bp.modelOverride).toBeNull();
    expect(body.models).toContain('sonnet');
    expect(body.levels).toContain('xhigh');
  });

  it('POST an override and GET reflects it in the effective columns', async () => {
    const post = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'blueprint', model: 'sonnet', effort: 'max' });
    expect(post!.status).toBe(200);
    const res = await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(NP_PROJECT)}`);
    const bp = ((await res!.json()) as any).rows.find((r: any) => r.kind === 'blueprint');
    expect(bp.effectiveModel).toBe('sonnet');
    expect(bp.effectiveEffort).toBe('max');
  });

  it('POST an unknown kind → 400', async () => {
    const res = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'bogus', model: 'opus' });
    expect(res!.status).toBe(400);
  });

  it('POST an invalid effort → 400', async () => {
    const res = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'review', effort: 'turbo' });
    expect(res!.status).toBe(400);
  });
});

describe('handleOrchestratorRoutes — node provider (per-node hybrid)', () => {
  const PV = '/tmp/orch-routes-provider';

  it('GET node-provider defaults to null (unset) with provider choices', async () => {
    const res = await call('GET', `/api/orchestrator/node-provider?project=${encodeURIComponent(PV)}`);
    const body = await res!.json() as any;
    expect(body.nodeProvider).toBeNull();
    expect(body.choices).toEqual(['claude', 'grok-build']);
  });

  it('POST node-provider persists grok-build and GET reads it back', async () => {
    await call('POST', '/api/orchestrator/node-provider', { project: PV, nodeProvider: 'grok-build' });
    const res = await call('GET', `/api/orchestrator/node-provider?project=${encodeURIComponent(PV)}`);
    expect(((await res!.json()) as any).nodeProvider).toBe('grok-build');
  });

  it('POST an invalid provider → 400', async () => {
    const res = await call('POST', '/api/orchestrator/node-provider', { project: PV, nodeProvider: 'gpt-9' });
    expect(res!.status).toBe(400);
  });

  it('node-profiles POST accepts a per-kind provider; GET surfaces it + mcpForced', async () => {
    const ok = await call('POST', '/api/orchestrator/node-profiles', { project: PV, kind: 'implement', provider: 'grok-build' });
    expect(ok!.status).toBe(200);
    const body = await (await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(PV)}`))!.json() as any;
    const impl = body.rows.find((r: { kind: string }) => r.kind === 'implement');
    const report = body.rows.find((r: { kind: string }) => r.kind === 'report');
    expect(impl.providerOverride).toBe('grok-build');
    expect(impl.effectiveProvider).toBe('grok-build');
    expect(report.mcpForced).toBe(true);
    expect(report.effectiveProvider).toBe('claude'); // MCP-forced
    expect(body.grokModels).toContain('grok-build');
  });

  it('node-profiles POST rejects grok on an MCP-forced kind → 400', async () => {
    const res = await call('POST', '/api/orchestrator/node-profiles', { project: PV, kind: 'report', provider: 'grok-build' });
    expect(res!.status).toBe(400);
  });
});
