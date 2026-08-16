/**
 * Gate spawn error marker — harness-thrown spawn failures are self-identifying
 * and survive into park reasons.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  defaultGateSpawn,
  GATE_SPAWN_ERROR_MARKER,
  formatGateSpawnError,
} from '../leaf-gate';
import { lastLines } from '../gate-runner';
import { formatGateErrorReason } from '../leaf-gate';
import type { LeafGateResult } from '../leaf-gate';

const ENV_KEYS = ['MERMAID_GATE_TIMEOUT_SECS', 'MERMAID_GATE_CONCURRENCY'];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('gate spawn error marker', () => {
  it('defaultGateSpawn marks a harness-thrown spawn failure with the gate-spawn-error marker', async () => {
    process.env.MERMAID_GATE_TIMEOUT_SECS = '30';
    process.env.MERMAID_GATE_CONCURRENCY = '4';
    // Spawn with a nonexistent cwd to trigger the harness throw.
    const r = await defaultGateSpawn('/no/such/directory/zzz', 'echo hi');
    expect(r.ran).toBe(false);
    expect(r.code).toBe(-1);
    expect(r.output).toContain(GATE_SPAWN_ERROR_MARKER);
    expect(r.output).toContain('/no/such/directory/zzz');
  });

  it('formatGateSpawnError names the error class and preserves the original message verbatim', () => {
    const e = new TypeError('undefined is not a function');
    const output = formatGateSpawnError('/some/cwd', "bun test 'file.ts'", e);
    expect(output).toContain('TypeError');
    expect(output).toContain('undefined is not a function');
    expect(output).toContain(GATE_SPAWN_ERROR_MARKER);
  });

  it('formatGateSpawnError output survives lastLines(output, 5) into the park reason', () => {
    // Create an error with a deep stack to test the truncation.
    const makeDeepStack = (): Error => {
      const a = () => {
        const b = () => {
          const c = () => {
            return new Error('deep stack error');
          };
          return c();
        };
        return b();
      };
      return a();
    };

    const e = makeDeepStack();
    const output = formatGateSpawnError('/cwd', "bun test 'file.ts'", e);
    const capped = lastLines(output, 5);

    // The marker must survive the 5-line truncation into the park reason.
    expect(capped).toContain(GATE_SPAWN_ERROR_MARKER);

    // Now verify it survives through formatGateErrorReason, which is where humans see it.
    const gateResult: LeafGateResult = {
      status: 'error',
      output: output,
      command: "bun test 'file.ts'",
      declared: true,
      reasons: [],
    };
    const reason = formatGateErrorReason(gateResult);
    expect(reason).toContain(GATE_SPAWN_ERROR_MARKER);
  });
});
