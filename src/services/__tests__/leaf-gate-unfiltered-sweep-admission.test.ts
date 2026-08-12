/**
 * leaf-gate-unfiltered-sweep-admission.test.ts — admission guard ensuring unfiltered
 * full-suite commands are confined to gate.floors[] (epic base + land only, never per-leaf).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManifestSource, ProjectManifest } from '../../config/project-manifest';
import { isUnfilteredFullSuiteCommand, resolveGateDeclaration, runLeafGate, runBaseGate } from '../leaf-gate';
import type { LeafGateConfig, GateSpawn } from '../leaf-gate';
import { loadManifestSource, _clearManifestCache } from '../../config/project-manifest';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'leaf-gate-unfiltered-'));
});

afterEach(() => {
  _clearManifestCache(workDir);
  rmSync(workDir, { recursive: true, force: true });
});

describe('isUnfilteredFullSuiteCommand predicate', () => {
  it('returns false for commands without scripts/test-backend.ts', () => {
    expect(isUnfilteredFullSuiteCommand('bun test {file}')).toBe(false);
    expect(isUnfilteredFullSuiteCommand('npx tsc --noEmit')).toBe(false);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/other-script.ts')).toBe(false);
  });

  it('returns false when {file} or {files} template is present', () => {
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts {file}')).toBe(false);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts {files}')).toBe(false);
  });

  it('returns false when there is a bare (non-flag) token after the script name', () => {
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts src/')).toBe(false);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts --lane=fast src/')).toBe(false);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts sometest')).toBe(false);
  });

  it('returns true for an unfiltered invocation with only flags', () => {
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts')).toBe(true);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts --lane=fast')).toBe(true);
    expect(isUnfilteredFullSuiteCommand('bun run scripts/test-backend.ts --baseline=...')).toBe(true);
  });
});

describe('resolveGateDeclaration admission/expulsion', () => {
  it('admits every real per-leaf lane and keeps the real floor lane', () => {
    const src = loadManifestSource(workDir);
    const decl = resolveGateDeclaration(src);
    // The real project.json has per-leaf lanes and floors with scripts/test-backend.ts only in floors.
    if (decl.kind === 'declared') {
      const cfg = decl.cfg;
      // Check that tests lanes (if any) do not have unfiltered commands.
      if (cfg.tests) {
        for (const lane of cfg.tests) {
          expect(isUnfilteredFullSuiteCommand(lane.command)).toBe(false);
        }
      }
      // Check that suites lanes (if any) do not have unfiltered commands.
      if (cfg.suites) {
        for (const lane of cfg.suites) {
          expect(isUnfilteredFullSuiteCommand(lane.command)).toBe(false);
        }
      }
      // Check that floors contain the real command (if floors exist).
      if (cfg.floors) {
        const hasFloorCommand = cfg.floors.some((f) => /scripts\/test-backend\.ts/.test(f.command));
        expect(hasFloorCommand).toBe(true);
      }
    }
  });

  it('expels an unfiltered scripts/test-backend.ts command declared in gate.suites', () => {
    const fixture: ManifestSource = {
      path: join(workDir, '.collab/project.json'),
      state: 'ok',
      manifest: {
        gate: {
          suites: [{ match: '.', command: 'bun run scripts/test-backend.ts' }],
        },
      } as ProjectManifest,
    };
    const decl = resolveGateDeclaration(fixture);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('floors');
    }
  });

  it('expels an unfiltered scripts/test-backend.ts command declared as legacy gateCommand', () => {
    const fixture: ManifestSource = {
      path: join(workDir, '.collab/project.json'),
      state: 'ok',
      manifest: {
        gateCommand: 'bun run scripts/test-backend.ts',
      } as ProjectManifest,
    };
    const decl = resolveGateDeclaration(fixture);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('floors');
    }
  });

  it('allows unfiltered command in gate.floors', () => {
    const fixture: ManifestSource = {
      path: join(workDir, '.collab/project.json'),
      state: 'ok',
      manifest: {
        gate: {
          floors: [{ match: '.', command: 'bun run scripts/test-backend.ts' }],
          tests: [{ match: '^src/', command: 'bun test {file}' }],
        },
      } as ProjectManifest,
    };
    const decl = resolveGateDeclaration(fixture);
    expect(decl.kind).toBe('declared');
  });
});

describe('runLeafGate and runBaseGate enforcement', () => {
  it('runLeafGate never spawns the floor command', async () => {
    const recorded: Array<{ cwd: string; command: string }> = [];
    const recordingSpawn: GateSpawn = async (cwd, command) => {
      recorded.push({ cwd, command });
      return { ran: true, code: 0, output: '' };
    };

    const cfg: LeafGateConfig = {
      floors: [{ match: /./, command: 'bun run scripts/test-backend.ts --lane=fast' }],
      tests: [{ match: /^src\//, command: 'bun test {file}', mode: 'per-file' }],
    };

    await runLeafGate(workDir, cfg, [], recordingSpawn);
    const runScripts = recorded.filter((r) => r.command.includes('scripts/test-backend.ts'));
    expect(runScripts.length).toBe(0);
  });

  it('runBaseGate spawns the floor command', async () => {
    const recorded: Array<{ cwd: string; command: string }> = [];
    const recordingSpawn: GateSpawn = async (cwd, command) => {
      recorded.push({ cwd, command });
      return { ran: true, code: 0, output: '' };
    };

    const cfg: LeafGateConfig = {
      floors: [{ match: /./, command: 'bun run scripts/test-backend.ts --lane=fast' }],
      tests: [{ match: /^src\//, command: 'bun test {file}', mode: 'per-file' }],
    };

    await runBaseGate(workDir, cfg, recordingSpawn);
    const runScripts = recorded.filter((r) => r.command.includes('scripts/test-backend.ts'));
    expect(runScripts.length).toBeGreaterThan(0);
  });
});
