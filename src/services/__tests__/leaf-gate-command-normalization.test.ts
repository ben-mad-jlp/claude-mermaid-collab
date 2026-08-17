/**
 * Test for leaf-gate command normalization: a bare `bun test {file}` lane declaration
 * is stored normalized to the `bun run scripts/test-backend.ts {file}` wrapper form.
 */
import { describe, it, expect } from 'bun:test';
import {
  resolveLeafGate,
  runLeafGate,
  type GateSpawn,
  type LeafGateConfig,
} from '../leaf-gate';
import type { ProjectManifest } from '../../config/project-manifest';

/** Builds a scripted GateSpawn: keyed by exact command string. */
function stubSpawn(script: Record<string, { ran: boolean; code?: number; output?: string }>) {
  const spawn: GateSpawn = async (cwd, command) => {
    const s = script[command];
    if (!s) throw new Error(`unscripted command: ${command}`);
    return { ran: s.ran, code: s.code ?? 0, output: s.output ?? '' };
  };
  return spawn;
}

describe('leaf-gate command normalization', () => {
  it('a bare runner declaration on a src path is stored normalized to the backend wrapper form', async () => {
    const cfg = resolveLeafGate({
      version: 1,
      gate: { tests: [{ match: '^src/', command: 'bun test {file}' }] },
    } as ProjectManifest);
    expect(cfg).not.toBeNull();

    const spawn = stubSpawn({
      "bun run scripts/test-backend.ts 'src/services/__tests__/some-example.test.ts'": {
        ran: true,
        code: 0,
      },
    });

    const r = await runLeafGate(
      '/wt',
      cfg,
      ['src/services/__tests__/some-example.test.ts'],
      spawn,
    );

    expect(r.laneRecords).toBeDefined();
    expect(r.laneRecords).toHaveLength(1);
    expect(r.laneRecords![0].executedCommand).toContain('scripts/test-backend.ts');
    expect(r.laneRecords![0].executedCommand).not.toMatch(/^bun\s+test\b/);
    expect(r.laneRecords![0].executedCommand).toBe(
      "bun run scripts/test-backend.ts 'src/services/__tests__/some-example.test.ts'",
    );
  });

  it('the normalized record carries a real verdict', async () => {
    const cfg = resolveLeafGate({
      version: 1,
      gate: { tests: [{ match: '^src/', command: 'bun test {file}' }] },
    } as ProjectManifest);
    expect(cfg).not.toBeNull();

    const spawn = stubSpawn({
      "bun run scripts/test-backend.ts 'src/services/__tests__/some-example.test.ts'": {
        ran: true,
        code: 0,
      },
    });

    const r = await runLeafGate(
      '/wt',
      cfg,
      ['src/services/__tests__/some-example.test.ts'],
      spawn,
    );

    expect(r.laneRecords).toBeDefined();
    expect(r.laneRecords![0].verdict).toBe('pass');
  });
});
