/**
 * Crash-loop self-heal (incident 2026-08-13): a stale persisted `session-current`
 * pointing at an unregistered project crashed every boot, and the error boundary's
 * reload button reloaded straight back into the same crash. The boundary now drops
 * the REBUILDABLE cache keys on the second consecutive boot crash.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { selfHealFromCrashLoop, REBUILDABLE_CACHE_KEYS, BOOT_CRASH_COUNT_KEY } from './App';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('selfHealFromCrashLoop', () => {
  let counter: Storage;
  let app: Storage;

  beforeEach(() => {
    counter = memStorage();
    app = memStorage();
    for (const k of REBUILDABLE_CACHE_KEYS) app.setItem(k, '{"poisoned":true}');
    app.setItem('ui-preferences', '{"keep":"me"}');
  });

  it('first crash: does NOT clear — the plain reload gets a chance', () => {
    expect(selfHealFromCrashLoop(counter, app)).toBe(false);
    expect(app.getItem('session-current')).not.toBeNull();
    expect(counter.getItem(BOOT_CRASH_COUNT_KEY)).toBe('1');
  });

  it('second consecutive crash: clears every rebuildable key, keeps preferences, resets the counter', () => {
    selfHealFromCrashLoop(counter, app);
    expect(selfHealFromCrashLoop(counter, app)).toBe(true);
    for (const k of REBUILDABLE_CACHE_KEYS) expect(app.getItem(k)).toBeNull();
    expect(app.getItem('ui-preferences')).toBe('{"keep":"me"}'); // never touches preferences
    expect(counter.getItem(BOOT_CRASH_COUNT_KEY)).toBe('0');
  });

  it('a successful boot between crashes (counter zeroed) means no heal on the next single crash', () => {
    selfHealFromCrashLoop(counter, app);
    counter.setItem(BOOT_CRASH_COUNT_KEY, '0'); // what App's mount effect does
    expect(selfHealFromCrashLoop(counter, app)).toBe(false);
    expect(app.getItem('session-current')).not.toBeNull();
  });
});
