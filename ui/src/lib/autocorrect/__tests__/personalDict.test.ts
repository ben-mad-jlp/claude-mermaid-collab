import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPersonalDict, addToPersonalDict } from '../personalDict';

describe('personalDict', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    global.localStorage = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('add then get returns the word', () => {
    addToPersonalDict('proj', 'Mission');
    expect(getPersonalDict('proj').has('mission')).toBe(true);
  });

  it('returns empty set when nothing stored', () => {
    expect(getPersonalDict('other').size).toBe(0);
  });

  it('returns empty set when localStorage is undefined', () => {
    const originalLocalStorage = global.localStorage;
    // @ts-ignore
    delete global.localStorage;
    expect(getPersonalDict('proj').size).toBe(0);
    global.localStorage = originalLocalStorage;
  });
});
