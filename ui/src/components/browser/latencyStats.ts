/**
 * Tiny fixed-window latency sampler for the streamed panel (9b8adcea). Keeps the
 * last N samples in a ring buffer and computes p50/p95 on demand — enough to read
 * frame-delivery and input round-trip latency live without a heavyweight metrics dep.
 */
export class LatencySampler {
  private buf: number[] = [];
  private cap: number;
  constructor(capacity = 240) { this.cap = capacity; }

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buf.push(ms);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  get count(): number { return this.buf.length; }

  /** Nearest-rank percentile (p in [0,1]); null when no samples. */
  percentile(p: number): number | null {
    if (this.buf.length === 0) return null;
    const sorted = [...this.buf].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
  }

  p50(): number | null { return this.percentile(0.5); }
  p95(): number | null { return this.percentile(0.95); }
  reset(): void { this.buf = []; }
}
