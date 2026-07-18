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
import { LEAF_NODE_KINDS, LEAF_NODE_GROUPS, ORCHESTRATION_NODE_KINDS } from '../../services/leaf-executor';
import { ORCHESTRATION_NODE_PROFILE } from '../../services/node-kinds';
import { projectRegistry } from '../../services/project-registry';
import { _closeDb } from '../../services/orchestrator-config';
import { _closeDb as supervisorCloseDb } from '../../services/supervisor-store';

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

beforeAll(() => {
  _closeDb();
  supervisorCloseDb();
});
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeDb();
  supervisorCloseDb();
});
afterAll(() => {
  _closeDb();
  supervisorCloseDb();
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
    // Use a non-default level ('off') so the round-trip proves persistence (the
    // unset default is 'on').
    const post = await call('POST', '/api/orchestrator/level', { project: PROJECT, level: 'off' });
    expect(post!.status).toBe(200);
    expect(await post!.json()).toEqual({ project: PROJECT, level: 'off' });

    const get = await call('GET', `/api/orchestrator/level?project=${encodeURIComponent(PROJECT)}`);
    expect(await get!.json()).toEqual({ project: PROJECT, level: 'off' });
  });

  it('POST level rejects an invalid level', async () => {
    const res = await call('POST', '/api/orchestrator/level', { project: PROJECT, level: 'bogus' });
    expect(res!.status).toBe(400);
  });

  it('POST level requires project', async () => {
    const res = await call('POST', '/api/orchestrator/level', { level: 'off' });
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
    // 'summary' is the Zen interpret-model knob, not a build node → excluded from the matrix.
    // Orchestration kinds (forge/conductor/planner) are included alongside the leaf kinds.
    expect(body.rows.length).toBe(LEAF_NODE_KINDS.filter((k) => k !== 'summary').length + ORCHESTRATION_NODE_KINDS.length);
    expect(body.rows.find((r: any) => r.kind === 'summary')).toBeUndefined();
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

  it('GET returns groups (5) whose kinds union equals LEAF_NODE_KINDS ∪ ORCHESTRATION_NODE_KINDS (partition/drift guard)', async () => {
    const res = await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(NP_PROJECT)}`);
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.length).toBe(5);
    const union = (body.groups as any[]).flatMap((g) => g.kinds);
    expect(new Set(union)).toEqual(new Set([...LEAF_NODE_KINDS, ...ORCHESTRATION_NODE_KINDS]));
    // Also verify against the exported constant directly (single source)
    const fromConst = LEAF_NODE_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(fromConst)).toEqual(new Set([...LEAF_NODE_KINDS, ...ORCHESTRATION_NODE_KINDS]));

    // body.rows carries one row per orchestration kind too, with the right defaults + mcpForced.
    for (const kind of ORCHESTRATION_NODE_KINDS) {
      const row = body.rows.find((r: any) => r.kind === kind);
      expect(row).toBeDefined();
      expect(row.defaultModel).toBe(ORCHESTRATION_NODE_PROFILE[kind].model);
      expect(row.defaultEffort).toBe(ORCHESTRATION_NODE_PROFILE[kind].effort);
    }
    expect(body.rows.find((r: any) => r.kind === 'conductor').mcpForced).toBe(true);
    expect(body.rows.find((r: any) => r.kind === 'planner').mcpForced).toBe(true);
    expect(body.rows.find((r: any) => r.kind === 'forge').mcpForced).toBe(false);
  });

  it('POST an override for an orchestration kind round-trips through GET', async () => {
    for (const kind of ORCHESTRATION_NODE_KINDS) {
      const post = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind, model: 'opus', effort: 'high' });
      expect(post!.status).toBe(200);
      const res = await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(NP_PROJECT)}`);
      const row = ((await res!.json()) as any).rows.find((r: any) => r.kind === kind);
      expect(row.modelOverride).toBe('opus');
      expect(row.effortOverride).toBe('high');
      expect(row.effectiveModel).toBe('opus');
      expect(row.effectiveEffort).toBe('high');
    }
  });

  it('POST rejects grok-build on conductor/planner (MCP-forced) but accepts it on forge', async () => {
    const conductor = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'conductor', provider: 'grok-build' });
    expect(conductor!.status).toBe(400);
    expect((await conductor!.json() as any).error).toContain('MCP');

    const planner = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'planner', provider: 'grok-build' });
    expect(planner!.status).toBe(400);
    expect((await planner!.json() as any).error).toContain('MCP');

    const forge = await call('POST', '/api/orchestrator/node-profiles', { project: NP_PROJECT, kind: 'forge', provider: 'grok-build', model: 'grok-build-0.1' });
    expect(forge!.status).toBe(200);
  });

  it('an orchestration-kind override survives broadcast to a second project', async () => {
    const SOURCE = mkdtempSync(join(tmpdir(), 'orch-routes-np-broadcast-source-'));
    const TARGET = mkdtempSync(join(tmpdir(), 'orch-routes-np-broadcast-target-'));
    await projectRegistry.register(SOURCE);
    await projectRegistry.register(TARGET);

    const post = await call('POST', '/api/orchestrator/node-profiles', { project: SOURCE, kind: 'planner', model: 'opus', effort: 'high' });
    expect(post!.status).toBe(200);

    const broadcast = await call('POST', '/api/orchestrator/node-profiles/broadcast', { project: SOURCE });
    expect(broadcast!.status).toBe(200);

    const res = await call('GET', `/api/orchestrator/node-profiles?project=${encodeURIComponent(TARGET)}`);
    const row = ((await res!.json()) as any).rows.find((r: any) => r.kind === 'planner');
    expect(row.modelOverride).toBe('opus');
    expect(row.effortOverride).toBe('high');
  });
});

describe('handleOrchestratorRoutes — node provider (per-node hybrid)', () => {
  const PV = '/tmp/orch-routes-provider';

  it('GET node-provider defaults to null (unset) with provider choices', async () => {
    const res = await call('GET', `/api/orchestrator/node-provider?project=${encodeURIComponent(PV)}`);
    const body = await res!.json() as any;
    expect(body.nodeProvider).toBeNull();
    expect(body.choices).toEqual(['claude', 'grok-build', 'grok-api']);
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
