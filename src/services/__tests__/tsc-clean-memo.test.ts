import { describe, it, expect, beforeEach } from 'bun:test';
import { memoizedTscClean, _resetTscCleanCache, TSC_CLEAN_TTL_MS } from '../steward-proof';

// A pristine worktree at HEAD X fully determines tsc input, so ${cwd}:${HEAD} is a safe
// cache key. A dirty tree (staged/unstaged/untracked) changes tsc input WITHOUT moving
// HEAD, so dirty trees must NEVER cache. This memo collapses identical (cwd, HEAD) pairs
// to ONE compile run — the fix for overeager tsc re-evaluation.
describe('memoizedTscClean', () => {
  beforeEach(() => _resetTscCleanCache());

  it('serves a repeated identical key from cache — compute runs ONCE', () => {
    let computes = 0;
    const call = () => memoizedTscClean({
      resolveKey: () => 'cwdA:shaX',
      compute: () => { computes++; return { pass: true, cacheable: true }; },
    });
    expect(call()).toBe(true);
    expect(call()).toBe(true);
    expect(call()).toBe(true);
    expect(computes).toBe(1);
  });

  it('a changed sha (cwd or HEAD moved) misses the cache and recomputes', () => {
    let computes = 0;
    const at = (key: string) => memoizedTscClean({
      resolveKey: () => key,
      compute: () => { computes++; return { pass: true, cacheable: true }; },
    });
    at('cwdA:shaX');
    at('cwdB:shaX'); // cwd changed
    at('cwdB:shaY'); // HEAD advanced
    expect(computes).toBe(3);
  });

  it('caches a genuine compile failure (pass:false, cacheable:true) too', () => {
    let computes = 0;
    const call = () => memoizedTscClean({
      resolveKey: () => 'cwdA:shaFail',
      compute: () => { computes++; return { pass: false, cacheable: true }; },
    });
    expect(call()).toBe(false);
    expect(call()).toBe(false);
    expect(computes).toBe(1);
  });

  it('NEVER caches a transient setup failure (cacheable:false) — recomputes every call', () => {
    let computes = 0;
    const call = () => memoizedTscClean({
      resolveKey: () => 'cwdA:shaLocked',
      compute: () => { computes++; return { pass: false, cacheable: false }; },
    });
    expect(call()).toBe(false);
    expect(call()).toBe(false);
    expect(computes).toBe(2);
  });

  it('an empty key (dirty tree or rev-parse failed) skips the cache entirely', () => {
    let computes = 0;
    const call = () => memoizedTscClean({
      resolveKey: () => '',
      compute: () => { computes++; return { pass: true, cacheable: true }; },
    });
    call();
    call();
    expect(computes).toBe(2);
  });

  it('expires a hit older than the TTL', () => {
    let computes = 0;
    let t = 1_000_000;
    const now = () => t;
    const call = () => memoizedTscClean({
      resolveKey: () => 'cwdA:shaX',
      compute: () => { computes++; return { pass: true, cacheable: true }; },
      now,
    });
    call();                       // stored at t=1_000_000
    t += TSC_CLEAN_TTL_MS - 1;    // still fresh
    call();
    expect(computes).toBe(1);
    t += 2;                       // now past the TTL
    call();
    expect(computes).toBe(2);
  });
});
