import { describe, it, expect } from 'vitest';
import { LatencySampler } from './latencyStats';

describe('LatencySampler', () => {
  it('computes nearest-rank p50/p95 over the window', () => {
    const s = new LatencySampler(100);
    for (let i = 1; i <= 100; i++) s.push(i); // 1..100
    expect(s.count).toBe(100);
    expect(s.p50()).toBe(50);
    expect(s.p95()).toBe(95);
  });

  it('returns null with no samples and ignores invalid values', () => {
    const s = new LatencySampler();
    expect(s.p50()).toBeNull();
    s.push(-5); s.push(NaN); s.push(Infinity);
    expect(s.count).toBe(0);
    s.push(10);
    expect(s.p50()).toBe(10);
  });

  it('evicts oldest beyond capacity (ring buffer)', () => {
    const s = new LatencySampler(3);
    s.push(100); s.push(1); s.push(2); s.push(3); // 100 evicted
    expect(s.count).toBe(3);
    expect(s.p95()).toBe(3);
  });
});
