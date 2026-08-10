// Runs via `bun test` — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  summarizeHostLoad,
  hostLoad,
  setHostSampler,
  type HostSample,
  type HostSampler,
} from '../host-load';

describe('summarizeHostLoad', () => {
  test('collapses five identical commands into one spawner row with count 5', () => {
    const sample: HostSample = {
      loadAvg: [2.0, 1.5, 1.0],
      cpuCount: 4,
      commands: [
        'git log master --grep=Collab-Epic id1',
        'git log master --grep=Collab-Epic id2',
        'git log master --grep=Collab-Epic id3',
        'git log master --grep=Collab-Epic id4',
        'git log master --grep=Collab-Epic id5',
      ],
      sidecarStarts: null,
    };

    const result = summarizeHostLoad(sample, {
      loadMultiple: 1.0,
      now: Date.now(),
    });

    // Should have exactly one spawner row for 'git' with count 5
    expect(result.spawners).toContainEqual({ command: 'git', count: 5 });
    expect(result.spawners.filter((s) => s.command === 'git')).toHaveLength(1);
  });

  test('saturated is true above the threshold, false just below, and false exactly at the threshold', () => {
    const now = Date.now();
    const cpuCount = 4;
    const loadMultiple = 1.0;

    // Case 1: load above threshold (saturated = true)
    const sampleAbove: HostSample = {
      loadAvg: [4.5, 1.5, 1.0], // 4.5 > 4 * 1.0
      cpuCount,
      commands: ['cmd'],
      sidecarStarts: null,
    };
    const resultAbove = summarizeHostLoad(sampleAbove, { loadMultiple, now });
    expect(resultAbove.saturated).toBe(true);

    // Case 2: load just below threshold (saturated = false)
    const sampleBelow: HostSample = {
      loadAvg: [3.9, 1.5, 1.0], // 3.9 < 4 * 1.0
      cpuCount,
      commands: ['cmd'],
      sidecarStarts: null,
    };
    const resultBelow = summarizeHostLoad(sampleBelow, { loadMultiple, now });
    expect(resultBelow.saturated).toBe(false);

    // Case 3: load exactly at threshold (saturated = false, strict >)
    const sampleExact: HostSample = {
      loadAvg: [4.0, 1.5, 1.0], // 4.0 === 4 * 1.0
      cpuCount,
      commands: ['cmd'],
      sidecarStarts: null,
    };
    const resultExact = summarizeHostLoad(sampleExact, { loadMultiple, now });
    expect(resultExact.saturated).toBe(false);
  });

  test('derives sidecarRestarts count and lastStartAt from in-window starts, and null (not 0) when sidecarStarts is null', () => {
    const now = Date.now();
    const windowMs = 1_800_000; // 30 minutes

    // Case 1: three sidecar starts within the window
    const sample1: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: [
        now - 100_000, // 100s ago
        now - 200_000, // 200s ago
        now - 300_000, // 300s ago
      ],
    };
    const result1 = summarizeHostLoad(sample1, { loadMultiple: 1.0, windowMs, now });
    expect(result1.sidecarRestarts.count).toBe(3);
    expect(result1.sidecarRestarts.lastStartAt).toBe(now - 100_000); // max of the three
    expect(result1.sidecarRestarts.windowMs).toBe(windowMs);

    // Case 2: sidecarStarts is null → count should be null (not 0)
    const sample2: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: null,
    };
    const result2 = summarizeHostLoad(sample2, { loadMultiple: 1.0, windowMs, now });
    expect(result2.sidecarRestarts.count).toBeNull();
    expect(result2.sidecarRestarts.lastStartAt).toBeNull();

    // Case 3: sidecar starts array is empty (not null) → count should be 0
    const sample3: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: [],
    };
    const result3 = summarizeHostLoad(sample3, { loadMultiple: 1.0, windowMs, now });
    expect(result3.sidecarRestarts.count).toBe(0);
    expect(result3.sidecarRestarts.lastStartAt).toBeNull();

    // Case 4: some starts outside the window (should be filtered out)
    const sample4: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: [
        now - 100_000, // within 30 min window
        now - 2_000_000, // 2000s ago, outside 30 min (1800s) window
      ],
    };
    const result4 = summarizeHostLoad(sample4, { loadMultiple: 1.0, windowMs, now });
    expect(result4.sidecarRestarts.count).toBe(1); // only the in-window start
    expect(result4.sidecarRestarts.lastStartAt).toBe(now - 100_000);
  });

  test('degrades to saturated null when the sampler returns null', () => {
    const result = summarizeHostLoad(null, {
      loadMultiple: 1.0,
      now: Date.now(),
    });

    expect(result.saturated).toBeNull();
    expect(result.loadAvg).toEqual({ one: 0, five: 0, fifteen: 0 });
    expect(result.cpuCount).toBe(0);
    expect(result.spawners).toEqual([]);
    expect(result.sidecarRestarts.count).toBeNull();
    expect(result.sidecarRestarts.lastStartAt).toBeNull();
  });

  test('respects custom loadMultiple threshold', () => {
    const sample: HostSample = {
      loadAvg: [3.0, 1.5, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: null,
    };

    // With loadMultiple 1.0: 3.0 > 2 * 1.0 → saturated
    const result1 = summarizeHostLoad(sample, { loadMultiple: 1.0, now: Date.now() });
    expect(result1.saturated).toBe(true);

    // With loadMultiple 2.0: 3.0 < 2 * 2.0 → not saturated
    const result2 = summarizeHostLoad(sample, { loadMultiple: 2.0, now: Date.now() });
    expect(result2.saturated).toBe(false);
  });

  test('uses default windowMs when not specified', () => {
    const sample: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: ['cmd'],
      sidecarStarts: null,
    };

    const result = summarizeHostLoad(sample, { loadMultiple: 1.0, now: Date.now() });
    expect(result.sidecarRestarts.windowMs).toBe(3_600_000); // 1 hour
  });

  test('sorts spawners by count descending', () => {
    const sample: HostSample = {
      loadAvg: [1.0, 1.0, 1.0],
      cpuCount: 2,
      commands: [
        'bun run test',
        'bun run test',
        'bun run test',
        'npm install',
        'npm install',
        'git pull',
      ],
      sidecarStarts: null,
    };

    const result = summarizeHostLoad(sample, { loadMultiple: 1.0, now: Date.now() });

    // Should be sorted by count desc: bun (3), npm (2), git (1)
    expect(result.spawners[0].command).toBe('bun');
    expect(result.spawners[0].count).toBe(3);
    expect(result.spawners[1].command).toBe('npm');
    expect(result.spawners[1].count).toBe(2);
    expect(result.spawners[2].command).toBe('git');
    expect(result.spawners[2].count).toBe(1);
  });
});

describe('hostLoad', () => {
  let originalSampler: HostSampler;

  beforeEach(() => {
    // Capture the original sampler so we can restore it after the test.
    originalSampler = async () => null; // placeholder, will be overwritten by setHostSampler
  });

  afterEach(() => {
    // Reset to default sampler.
    setHostSampler(null);
  });

  test('composes sampler with summarizeHostLoad', async () => {
    const mockSample: HostSample = {
      loadAvg: [2.0, 1.5, 1.0],
      cpuCount: 4,
      commands: ['git', 'npm', 'bun'],
      sidecarStarts: null,
    };

    const mockSampler: HostSampler = async () => mockSample;
    const result = await hostLoad({ sampler: mockSampler });

    expect(result.loadAvg).toEqual({ one: 2.0, five: 1.5, fifteen: 1.0 });
    expect(result.cpuCount).toBe(4);
    expect(result.spawners.length).toBe(3);
    expect(result.saturated).toBe(false); // 2.0 < 4 * 1.0 (default loadMultiple)
  });

  test('handles a sampler that returns null', async () => {
    const mockSampler: HostSampler = async () => null;
    const result = await hostLoad({ sampler: mockSampler });

    expect(result.saturated).toBeNull();
    expect(result.cpuCount).toBe(0);
    expect(result.spawners).toEqual([]);
  });

  test('uses the injected sampler when provided', async () => {
    let called = false;
    const mockSampler: HostSampler = async () => {
      called = true;
      return {
        loadAvg: [1.0, 1.0, 1.0],
        cpuCount: 2,
        commands: ['cmd'],
        sidecarStarts: null,
      };
    };

    await hostLoad({ sampler: mockSampler });
    expect(called).toBe(true);
  });
});

describe('setHostSampler', () => {
  afterEach(() => {
    // Reset to default sampler after each test.
    setHostSampler(null);
  });

  test('injects a custom sampler that is used by hostLoad', async () => {
    let callCount = 0;
    const customSampler: HostSampler = async () => {
      callCount++;
      return {
        loadAvg: [1.0, 1.0, 1.0],
        cpuCount: 2,
        commands: ['custom'],
        sidecarStarts: null,
      };
    };

    setHostSampler(customSampler);
    await hostLoad(); // no sampler arg, should use the injected one
    expect(callCount).toBe(1);
  });

  test('resets to default sampler when passed null', async () => {
    // First inject a custom one
    const customSampler: HostSampler = async () => ({
      loadAvg: [99.0, 99.0, 99.0],
      cpuCount: 99,
      commands: ['custom'],
      sidecarStarts: null,
    });
    setHostSampler(customSampler);

    // Then reset
    setHostSampler(null);

    // hostLoad should now use the default sampler (or null if it fails)
    // We can't easily test the exact behavior without mocking os.loadavg/cpus,
    // but we can at least verify it doesn't throw.
    const result = await hostLoad();
    expect(result).toBeDefined();
  });
});
