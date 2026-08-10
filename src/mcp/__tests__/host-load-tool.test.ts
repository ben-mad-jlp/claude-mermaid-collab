/**
 * End-to-end test for host_load MCP verb.
 * Drives the tool through handleSystemTool with an injected deterministic sampler.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { handleSystemTool } from '../system-tools.js';
import { setHostSampler, type HostSample } from '../../services/host-load.js';

describe('host_load MCP verb', () => {
  afterEach(() => {
    // Reset the sampler so it doesn't leak into other tests
    setHostSampler(null);
  });

  it('drives host_load via handleSystemTool with a deterministic sampler and asserts bucketed spawners, saturated, and sidecarRestarts.lastStartAt', async () => {
    // Set up a deterministic sampler that captures current time
    // This ensures timestamps are relative to when the test runs
    setHostSampler(async () => {
      const now = Date.now();
      return {
        loadAvg: [4, 2, 1],
        cpuCount: 2,
        // Simulate repeated command and one distinct command
        commands: [
          'node /app/server.js',
          'node /app/server.js',
          'node /app/server.js',
          'bun run test',
          'ps aux',
          'ps aux',
        ],
        sidecarStarts: [now - 100, now - 50000], // Two starts within the last minute
      };
    });

    // Call the tool with no arguments (uses default windowMs)
    const result = await handleSystemTool('host_load', {});
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!);

    // Assert load averages
    expect(parsed.loadAvg).toEqual({ one: 4, five: 2, fifteen: 1 });

    // Assert CPU count
    expect(parsed.cpuCount).toBe(2);

    // Assert saturation: 1-minute load (4) > cpuCount (2) * loadMultiple (1.0) = 2, so saturated should be true
    expect(parsed.saturated).toBe(true);

    // Assert spawners are bucketed correctly
    expect(parsed.spawners).toBeDefined();
    expect(parsed.spawners.length).toBeGreaterThan(0);

    // Find the repeated command bucket
    const nodeServerRow = parsed.spawners.find((s: any) => s.command === 'node');
    expect(nodeServerRow).toBeDefined();
    expect(nodeServerRow.count).toBe(3); // Three instances of 'node' (from argv[0] bucketing)

    // Assert sidecarRestarts contains the timestamps
    expect(parsed.sidecarRestarts).toBeDefined();
    expect(parsed.sidecarRestarts.count).toBe(2);
    // The lastStartAt should be the maximum of the two timestamps (the more recent one)
    expect(parsed.sidecarRestarts.lastStartAt).not.toBeNull();
    expect(parsed.sidecarRestarts.windowMs).toBeDefined();
  });

  it('respects windowMs parameter when passed', async () => {
    // Set up a sampler that captures current time
    setHostSampler(async () => {
      const now = Date.now();
      return {
        loadAvg: [1, 1, 1],
        cpuCount: 2,
        commands: ['node'],
        // One start 2 hours ago, one start 10 minutes ago
        sidecarStarts: [now - 7200000, now - 600000],
      };
    });

    // Call with a 30-minute (1_800_000 ms) window
    const result = await handleSystemTool('host_load', { windowMs: 1_800_000 });
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!);

    // With a 30-minute window, only the start from 10 minutes ago should be included
    expect(parsed.sidecarRestarts.count).toBe(1);
    expect(parsed.sidecarRestarts.lastStartAt).not.toBeNull();
    expect(parsed.sidecarRestarts.windowMs).toBe(1_800_000);
  });

  it('handles null sample gracefully', async () => {
    setHostSampler(async () => null);

    const result = await handleSystemTool('host_load', {});
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!);

    // Should have safe defaults
    expect(parsed.loadAvg).toEqual({ one: 0, five: 0, fifteen: 0 });
    expect(parsed.cpuCount).toBe(0);
    expect(parsed.spawners).toEqual([]);
    expect(parsed.sidecarRestarts.count).toBeNull();
    expect(parsed.saturated).toBeNull();
  });
});
