import { describe, it, expect } from 'bun:test';
import { nicknameFromTitle, uniqueNickname } from '../entity-nickname';

describe('nicknameFromTitle', () => {
  it('same title always yields the identical slug', () => {
    const title = '[EPIC] Fix the login page bug';
    expect(nicknameFromTitle(title)).toBe(nicknameFromTitle(title));
  });

  it('yields a slug of 2-4 hyphen-joined words with no brackets or punctuation', () => {
    const slug = nicknameFromTitle('[EPIC] Fix the login page bug');
    expect(slug).not.toMatch(/[\[\]!?.,]/);
    const parts = slug.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(4);
  });

  it('empty, punctuation-only, and emoji-only titles yield a non-empty slug', () => {
    expect(nicknameFromTitle('').length).toBeGreaterThan(0);
    expect(nicknameFromTitle('!!! --- ???').length).toBeGreaterThan(0);
    expect(nicknameFromTitle('🎉🎉🎉').length).toBeGreaterThan(0);
  });

  it('is deterministic for degenerate titles too', () => {
    expect(nicknameFromTitle('🎉🎉🎉')).toBe(nicknameFromTitle('🎉🎉🎉'));
  });
});

describe('uniqueNickname', () => {
  it('appends a numeric suffix when the base is already taken', () => {
    expect(uniqueNickname('foo', ['foo', 'foo-2'])).toBe('foo-3');
  });

  it('returns the base unchanged when not taken', () => {
    expect(uniqueNickname('foo', ['bar'])).toBe('foo');
  });
});
