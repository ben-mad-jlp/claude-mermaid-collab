// The process-guard handlers must record a caught detached-work failure (so it
// surfaces in /api/health) WITHOUT the process exiting. We test the exported
// handler bodies directly — registering real process listeners would leak
// across the runner and can't assert "did not exit" cleanly.
import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import {
  handleUnhandledRejection,
  handleUncaughtException,
  getProcessGuardStats,
  _resetProcessGuardStats,
} from '../process-guards';

describe('process-guards', () => {
  beforeEach(() => { _resetProcessGuardStats(); });

  test('starts clean', () => {
    expect(getProcessGuardStats()).toEqual({ unhandledRejections: 0, uncaughtExceptions: 0, lastError: null });
  });

  test('an unhandled rejection is counted + recorded, not rethrown', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    // The call itself returning normally IS the "does not crash" assertion.
    handleUnhandledRejection(new Error('spawn ENOENT: mermaid-collab'), '2026-07-06T00:00:00.000Z');
    errSpy.mockRestore();
    const s = getProcessGuardStats();
    expect(s.unhandledRejections).toBe(1);
    expect(s.uncaughtExceptions).toBe(0);
    expect(s.lastError).toEqual({ kind: 'unhandledRejection', message: 'Error: spawn ENOENT: mermaid-collab', at: '2026-07-06T00:00:00.000Z' });
  });

  test('an uncaught exception is counted + recorded', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    handleUncaughtException(new TypeError('boom'), '2026-07-06T01:02:03.000Z');
    errSpy.mockRestore();
    const s = getProcessGuardStats();
    expect(s.uncaughtExceptions).toBe(1);
    expect(s.lastError).toEqual({ kind: 'uncaughtException', message: 'TypeError: boom', at: '2026-07-06T01:02:03.000Z' });
  });

  test('non-Error rejection reasons are stringified, last write wins', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    handleUnhandledRejection(new Error('first'), '2026-07-06T00:00:00.000Z');
    handleUnhandledRejection('plain string reason', '2026-07-06T00:00:05.000Z');
    errSpy.mockRestore();
    const s = getProcessGuardStats();
    expect(s.unhandledRejections).toBe(2);
    expect(s.lastError?.message).toBe('plain string reason');
    expect(s.lastError?.at).toBe('2026-07-06T00:00:05.000Z');
  });
});
