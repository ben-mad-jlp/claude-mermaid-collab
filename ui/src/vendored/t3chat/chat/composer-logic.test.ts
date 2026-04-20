import { describe, it, expect } from 'vitest';
import { detectSlashTrigger } from './composer-logic';

describe('detectSlashTrigger', () => {
  it('detects / at start', () => {
    expect(detectSlashTrigger('/he', 3)).toEqual({ query: 'he', start: 0, end: 3 });
  });

  it('detects / after space', () => {
    expect(detectSlashTrigger('hello /pl', 9)).toEqual({ query: 'pl', start: 6, end: 9 });
  });

  it('returns null inside a word', () => {
    expect(detectSlashTrigger('foo/bar', 7)).toBeNull();
  });

  it('returns null without slash', () => {
    expect(detectSlashTrigger('hello', 5)).toBeNull();
  });

  it('allows empty query after slash', () => {
    expect(detectSlashTrigger('/', 1)).toEqual({ query: '', start: 0, end: 1 });
  });
});
