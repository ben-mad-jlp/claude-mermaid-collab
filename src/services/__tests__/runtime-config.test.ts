// Pure summarizeRuntimeConfig tests — no real env, sockets, or processes.
import { describe, test, expect } from 'bun:test';
import {
  summarizeRuntimeConfig,
  type RuntimeConfigInputs,
} from '../runtime-config';
import type { PoolConfig } from '../worker-pool';

function poolSizes(overrides: Partial<PoolConfig> = {}): PoolConfig {
  return {
    frontend: 3,
    backend: 1,
    api: 1,
    ui: 1,
    library: 1,
    cad: 1,
    general: 1,
    ...overrides,
  };
}

function inputs(overrides: Partial<RuntimeConfigInputs> = {}): RuntimeConfigInputs {
  return {
    project: '/p',
    now: 1000,
    workerIsolation: false,
    poolSizes: poolSizes(),
    maxColdStarts: 2,
    deadGraceMs: 45000,
    perProjectWatchdogThreshold: null,
    defaultWatchdogThreshold: 80,
    orchestratorLevel: 'build',
    stewardPaused: false,
    stewardLive: true,
    stewardAutoEnabled: false,
    stewardSwitchedOn: false,
    supervisorPausedForProject: false,
    supervisorPauses: [],
    selfSummaryNudgeEnabled: true,
    selfSummaryNudgeIntervalMs: 5 * 60_000,
    ...overrides,
  };
}

describe('summarizeRuntimeConfig', () => {
  test('composes every resolved flag', () => {
    const c = summarizeRuntimeConfig(inputs());
    expect(c.flags.workerIsolation).toBe(false);
    expect(c.flags.poolSizes.frontend).toBe(3);
    expect(c.flags.poolSizes.backend).toBe(1);
    expect(c.flags.maxColdStarts).toBe(2);
    expect(c.flags.deadGraceMs).toBe(45000);
  });

  test('watchdog falls back to the default when no per-project override is set', () => {
    const c = summarizeRuntimeConfig(inputs());
    expect(c.flags.watchdog.perProjectOverride).toBeNull();
    expect(c.flags.watchdog.defaultPercent).toBe(80);
    expect(c.flags.watchdog.effectivePercent).toBe(80);
  });

  test('a per-project watchdog override takes effect over the default', () => {
    const c = summarizeRuntimeConfig(inputs({ perProjectWatchdogThreshold: 65 }));
    expect(c.flags.watchdog.perProjectOverride).toBe(65);
    expect(c.flags.watchdog.effectivePercent).toBe(65);
    expect(c.flags.watchdog.defaultPercent).toBe(80);
  });

  test('surfaces every pause / override state', () => {
    const c = summarizeRuntimeConfig(
      inputs({
        workerIsolation: true,
        orchestratorLevel: 'plan',
        stewardPaused: true,
        stewardLive: false,
        stewardAutoEnabled: true,
        stewardSwitchedOn: true,
        supervisorPausedForProject: true,
        supervisorPauses: [{ scope: 'global', pausedAt: 500 }],
      }),
    );
    expect(c.flags.workerIsolation).toBe(true);
    expect(c.overrides.orchestrator.level).toBe('plan');
    expect(c.overrides.steward.paused).toBe(true);
    expect(c.overrides.steward.live).toBe(false);
    expect(c.overrides.steward.autoEnabled).toBe(true);
    expect(c.overrides.steward.switchedOn).toBe(true);
    expect(c.overrides.supervisor.pausedForProject).toBe(true);
    expect(c.overrides.supervisor.pauses).toEqual([{ scope: 'global', pausedAt: 500 }]);
  });

  test('exposes drill-down pointers to the tools that change each field', () => {
    const c = summarizeRuntimeConfig(inputs());
    expect(c.pointers.watchdog).toBe('set_watchdog_threshold');
    expect(c.pointers.orchestrator).toBe('orchestrator_status');
  });
});
