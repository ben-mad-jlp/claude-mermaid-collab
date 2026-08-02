import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must set BEFORE importing modules that depend on MERMAID_SUPERVISOR_DIR
const dir = mkdtempSync(join(tmpdir(), 'conductor-kill-rate-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  conductorKillRate,
  CONDUCTOR_KILL_RATE_BASELINE,
  CONDUCTOR_KILL_RATE_SOURCE,
  CONDUCTOR_KILL_RATE_WINDOW_MS,
  _resetConductorKillRateThrottle,
} from '../conductor-kill-rate.js';
import { recordNode } from '../worker-ledger.js';

describe('conductor-kill-rate', () => {
  beforeEach(() => {
    _resetConductorKillRateThrottle();
  });

  it('seeded worker_ledger with 3 timedOut=1 and 7 timedOut=0 conductor rows INSIDE the window plus 5 timedOut=1 rows OUTSIDE it reports killed=3 total=10 rate=0.30', () => {
    const now = Date.now();
    const windowMs = CONDUCTOR_KILL_RATE_WINDOW_MS;
    const insideWindow = now - windowMs / 2; // Middle of window
    const outsideWindow = now - windowMs - 24 * 60 * 60_000; // 1 day before window start

    // Inside window: 3 kills + 7 non-kills
    for (let i = 0; i < 3; i++) {
      recordNode({
        project: 'test-project-window',
        todoId: `todo-${i}`,
        session: 'test-session',
        source: CONDUCTOR_KILL_RATE_SOURCE,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        knownPrice: true,
        steps: 1,
        timedOut: true,
      }, insideWindow);
    }
    for (let i = 0; i < 7; i++) {
      recordNode({
        project: 'test-project-window',
        todoId: `todo-${i + 3}`,
        session: 'test-session',
        source: CONDUCTOR_KILL_RATE_SOURCE,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        knownPrice: true,
        steps: 1,
        timedOut: false,
      }, insideWindow);
    }

    // Outside window: 5 kills (should be excluded)
    for (let i = 0; i < 5; i++) {
      recordNode({
        project: 'test-project-window',
        todoId: `todo-outside-${i}`,
        session: 'test-session',
        source: CONDUCTOR_KILL_RATE_SOURCE,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        knownPrice: true,
        steps: 1,
        timedOut: true,
      }, outsideWindow);
    }

    const rate = conductorKillRate({ windowMs, now });
    expect(rate.killed).toBe(3);
    expect(rate.total).toBe(10);
    expect(Math.abs(rate.rate - 0.30) < 0.01).toBe(true); // Allow small floating point error
  });

  it('a non-conductor source row inside the window is excluded', () => {
    // Use a much later timestamp so the first test's rows fall outside the window
    const now = Date.now() + 8 * 24 * 60 * 60_000; // 8 days in the future
    const windowMs = CONDUCTOR_KILL_RATE_WINDOW_MS;
    const insideWindow = now - windowMs / 2;

    // Record a non-conductor source row (should be excluded)
    recordNode({
      project: 'test-project-exclusion',
      todoId: 'todo-other-source',
      session: 'test-session',
      source: 'other-source', // Not CONDUCTOR_KILL_RATE_SOURCE
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0,
      knownPrice: true,
      steps: 1,
      timedOut: true,
    }, insideWindow);

    // Record conductor source rows
    recordNode({
      project: 'test-project-exclusion',
      todoId: 'todo-conductor-1',
      session: 'test-session',
      source: CONDUCTOR_KILL_RATE_SOURCE,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0,
      knownPrice: true,
      steps: 1,
      timedOut: false,
    }, insideWindow);

    const rate = conductorKillRate({ windowMs, now });
    expect(rate.killed).toBe(0);
    expect(rate.total).toBe(1); // Only the conductor source row is counted
    expect(rate.rate).toBe(0);
  });

  it('conductorKillRate fails-open and returns zero rate when the ledger query throws', async () => {
    const { runConductorKillRateArm } = await import('../conductor-kill-rate.js');
    const now = Date.now();

    // Fault-inject a killRate function that throws
    const result = await runConductorKillRateArm('test-project-fail-open', {
      now: () => now,
      killRate: () => {
        throw new Error('Simulated ledger query failure');
      },
    });

    // The arm should catch the error and return cardRaised: false (fail-open)
    expect(result.cardRaised).toBe(false);
  });
});
