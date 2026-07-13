import { describe, it, expect, beforeEach } from 'bun:test';
import { memoizedMergeClean, _resetMergeCleanCache, MERGE_CLEAN_TTL_MS } from '../steward-proof';

// The daemon calls validateStewardProof('land_epic') 3× per epic per reconcile tick, each
// running a `git worktree add`+merge+remove+prune trial. This memo collapses identical
// (masterSha, epicBranchSha) trials to ONE run — the fix for the daemon "creep".
describe('memoizedMergeClean', () => {
  beforeEach(() => _resetMergeCleanCache());

  it('serves a repeated identical key from cache — compute runs ONCE', () => {
    let computes = 0;
    const call = () => memoizedMergeClean({
      resolveKey: () => 'masterA:epicX',
      compute: () => { computes++; return { clean: true, cacheable: true }; },
    });
    expect(call()).toBe(true);
    expect(call()).toBe(true);
    expect(call()).toBe(true);
    expect(computes).toBe(1); // 3 daemon calls this tick → ONE trial merge
  });

  it('a changed sha (either branch moved) misses the cache and recomputes', () => {
    let computes = 0;
    const at = (key: string) => memoizedMergeClean({
      resolveKey: () => key,
      compute: () => { computes++; return { clean: true, cacheable: true }; },
    });
    at('masterA:epicX');
    at('masterB:epicX'); // master advanced
    at('masterB:epicY'); // epic advanced
    expect(computes).toBe(3);
  });

  it('caches a genuine conflict (clean:false, cacheable:true) too', () => {
    let computes = 0;
    const call = () => memoizedMergeClean({
      resolveKey: () => 'masterA:epicConflict',
      compute: () => { computes++; return { clean: false, cacheable: true }; },
    });
    expect(call()).toBe(false);
    expect(call()).toBe(false);
    expect(computes).toBe(1);
  });

  it('NEVER caches a transient setup failure (cacheable:false) — recomputes every call', () => {
    let computes = 0;
    const call = () => memoizedMergeClean({
      resolveKey: () => 'masterA:epicLocked',
      compute: () => { computes++; return { clean: false, cacheable: false }; },
    });
    expect(call()).toBe(false);
    expect(call()).toBe(false);
    expect(computes).toBe(2); // a worktree lock must not poison the cache
  });

  it('an empty key (rev-parse failed) skips the cache entirely', () => {
    let computes = 0;
    const call = () => memoizedMergeClean({
      resolveKey: () => '',
      compute: () => { computes++; return { clean: true, cacheable: true }; },
    });
    call();
    call();
    expect(computes).toBe(2);
  });

  it('expires a hit older than the TTL', () => {
    let computes = 0;
    let t = 1_000_000;
    const now = () => t;
    const call = () => memoizedMergeClean({
      resolveKey: () => 'masterA:epicX',
      compute: () => { computes++; return { clean: true, cacheable: true }; },
      now,
    });
    call();                         // stored at t=1_000_000
    t += MERGE_CLEAN_TTL_MS - 1;    // still fresh
    call();
    expect(computes).toBe(1);
    t += 2;                         // now past the TTL
    call();
    expect(computes).toBe(2);
  });
});
