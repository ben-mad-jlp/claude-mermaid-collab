import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  defaultHostSampler,
  hostLoad,
  setHostSampler,
  type HostSample,
} from '../../services/host-load.js';
import { handleSystemTool } from '../system-tools.js';

let originalMultiple: string | undefined;

describe('host-load production path', () => {
  beforeEach(() => {
    setHostSampler(null);
    originalMultiple = process.env.MERMAID_SATURATION_LOAD_MULTIPLE;
    process.env.MERMAID_SATURATION_LOAD_MULTIPLE = '1.0';
  });

  afterEach(() => {
    setHostSampler(null);
    if (originalMultiple === undefined) {
      delete process.env.MERMAID_SATURATION_LOAD_MULTIPLE;
    } else {
      process.env.MERMAID_SATURATION_LOAD_MULTIPLE = originalMultiple;
    }
  });

  it('defaultHostSampler returns a real sample with cpuCount >= 1 and a finite loadAvg[0]', async () => {
    const sample = await defaultHostSampler();
    expect(sample).not.toBeNull();
    expect(sample!.cpuCount).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(sample!.loadAvg[0])).toBe(true);
  });

  it('hostLoad() with no opts and no injected sampler returns a typed saturated boolean against the real host', async () => {
    const result = await hostLoad();
    expect(result.cpuCount).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(result.loadAvg.one)).toBe(true);
    expect(typeof result.saturated).toBe('boolean');
  });

  it('host_load MCP verb end-to-end against the real host returns untruncated spawner commands', async () => {
    const raw = await handleSystemTool('host_load', {});
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);

    expect(parsed.cpuCount).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(parsed.loadAvg.one)).toBe(true);
    expect(typeof parsed.saturated).toBe('boolean');

    expect(parsed.spawners.length).toBeGreaterThan(0);
    expect(
      parsed.spawners.some(
        (s: any) => s.command.includes('/') || s.command.length > 16,
      ),
    ).toBe(true);
  });
});
