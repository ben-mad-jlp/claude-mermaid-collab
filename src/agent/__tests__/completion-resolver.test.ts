import { describe, expect, it } from 'bun:test';
import { resolveCompletion } from '../completion-resolver.js';
import type { GateVerdict } from '../../services/coordinator-daemon.js';

describe('resolveCompletion — base-attributed gate failure', () => {
  it('resolveCompletion downgrades a base-attributed gate failure to pending with baseRed, not rejected', async () => {
    const baseAttributed = { command: 'npm test', failingFiles: ['src/foo.ts'], signature: 'sig-1' };
    const verdict: GateVerdict = { passed: false, reasons: ['gate failed'], baseAttributed };
    const result = await resolveCompletion(
      { runGate: async () => verdict },
      'proj',
      'leaf-1',
      'accepted',
    );
    expect(result.effective).toBe('pending');
    expect(result.baseRed).toEqual(baseAttributed);
    expect(result.gateOverride).toBeUndefined();
    expect(result.pendingReason).toBe('epic-base-red: npm test');
  });

  it('resolveCompletion still rejects an unattributable gate failure with gateOverride, no baseRed', async () => {
    const verdict: GateVerdict = { passed: false, reasons: ['gate failed'] };
    const result = await resolveCompletion(
      { runGate: async () => verdict },
      'proj',
      'leaf-1',
      'accepted',
    );
    expect(result.effective).toBe('rejected');
    expect(result.gateOverride).toEqual(verdict);
    expect(result.baseRed).toBeUndefined();
  });
});

describe('resolveCompletion — rejected path re-gate', () => {
  it('resolveCompletion re-gates a rejected acceptance and downgrades a base-attributed verdict to pending', async () => {
    const baseAttributed = { command: 'npm test', failingFiles: ['src/foo.ts'], signature: 'sig-1' };
    const verdict: GateVerdict = { passed: false, reasons: ['gate failed'], baseAttributed };
    const result = await resolveCompletion(
      { runGate: async () => verdict },
      'proj',
      'leaf-1',
      'rejected',
    );
    expect(result.effective).toBe('pending');
    expect(result.baseRed).toEqual(baseAttributed);
    expect(result.pendingReason).toBe('epic-base-red: npm test');
  });

  it('resolveCompletion keeps a rejected acceptance rejected when the failing verdict has no baseAttributed', async () => {
    const verdict: GateVerdict = { passed: false, reasons: ['gate failed'] };
    const result = await resolveCompletion(
      { runGate: async () => verdict },
      'proj',
      'leaf-1',
      'rejected',
    );
    expect(result.effective).toBe('rejected');
    expect(result.gateOverride).toBeUndefined();
    expect(result.baseRed).toBeUndefined();
  });

  it('resolveCompletion with source admin keeps rejected even for a base-attributed verdict', async () => {
    const baseAttributed = { command: 'npm test', failingFiles: ['src/foo.ts'], signature: 'sig-1' };
    const verdict: GateVerdict = { passed: false, reasons: ['gate failed'], baseAttributed };
    let gateCalls = 0;
    const result = await resolveCompletion(
      { runGate: async () => { gateCalls++; return verdict; } },
      'proj',
      'leaf-1',
      'rejected',
      { source: 'admin' },
    );
    expect(result.effective).toBe('rejected');
    expect(gateCalls).toBe(0);
  });
});
