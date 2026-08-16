/**
 * Base-gate infra-degraded typecheck classification: when a typecheck lane exits
 * non-zero but emits ONLY dependency-resolution diagnostics (TS2307/TS7016/TS2503/TS7006),
 * it is treated as an INCIDENT (status 'error', infraDegraded: true) rather than a base
 * FACT — not persisted, released instead of parked.
 *
 * Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
  type SharedVerdictScope,
} from '../base-gate-coalescer';
import {
  getBaseGateVerdict,
  _closeLedgerDb,
} from '../worker-ledger';
import { runBaseGate, type LeafGateConfig, type GateSpawn } from '../leaf-gate';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let dir: string;

const CFG: LeafGateConfig = { typecheck: 'npx tsc --noEmit' };

// Fixture: dependency-resolution-only output (all TS2307/TS7016/TS7006 codes)
const CACHED_DEPS_ONLY_OUTPUT = `desktop/src/component.tsx(3,24): error TS2307: Cannot find module 'react' or its corresponding type declarations.
desktop/src/component.tsx(5,10): error TS2307: Cannot find module '@types/node' or its corresponding type declarations.
desktop/src/utils.ts(12,5): error TS7016: Could not find a declaration file for module 'some-package'.
desktop/src/helpers.ts:8:15 - error TS7006: Parameter 'e' implicitly has an 'any' type.
desktop/src/index.tsx(1,1): error TS2307: Cannot find module 'missing-lib' or its corresponding type declarations.`;

function scope(over: Partial<SharedVerdictScope> = {}): SharedVerdictScope {
  return { project: '/proj', baseSha: 'sha1', quarantineHash: quarantineSetHash([]), ...over };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'base-gate-infra-degraded-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
  resetBaseGateCoalescer();
});

afterEach(() => {
  _closeLedgerDb();
  _closeSupervisorDb();
  resetBaseGateCoalescer();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('base-gate infra-degraded typecheck classification', () => {
  test('a dependency-resolution-only typecheck lane returns error with infraDegraded and persists no shared verdict', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    const spawn: GateSpawn = async () => ({
      ran: true,
      code: 1,
      output: CACHED_DEPS_ONLY_OUTPUT,
    });

    const result = await runBaseGateShared(
      key,
      async () => runBaseGate('/cwd', CFG, spawn),
      { project: '/proj', verdict: scope() },
    );

    expect(result.status).toBe('error');
    expect(result.infraDegraded).toBe(true);
    expect(result.reasons[0]).toContain('infra-degraded: typecheck reported only dependency-resolution diagnostics');

    // Assertion 2: the persist never happened — no shared verdict stored
    const storedVerdict = getBaseGateVerdict(sharedVerdictKey(key, quarantineSetHash([])));
    expect(storedVerdict).toBeNull();
  });

  test('control: the same output carrying a TS2345 diagnostic records a fail verdict', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    // Add one TS2345 (a real type error, not a dependency-resolution code)
    const outputWithRealError = CACHED_DEPS_ONLY_OUTPUT +
      '\ndesktop/src/api.ts(20,10): error TS2345: Argument of type \'string\' is not assignable to parameter of type \'number\'.';

    const spawn: GateSpawn = async () => ({
      ran: true,
      code: 1,
      output: outputWithRealError,
    });

    const result = await runBaseGateShared(
      key,
      async () => runBaseGate('/cwd', CFG, spawn),
      { project: '/proj', verdict: scope() },
    );

    expect(result.status).toBe('fail');
    expect(result.infraDegraded).toBeFalsy();

    // Assertion: the stored verdict IS present with status 'fail'
    const storedVerdict = getBaseGateVerdict(sharedVerdictKey(key, quarantineSetHash([])));
    expect(storedVerdict).toBeDefined();
    expect(storedVerdict?.status).toBe('fail');
  });
});
