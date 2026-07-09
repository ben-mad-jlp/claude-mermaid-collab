import { describe, it, expect } from 'vitest';
import { isBucketEpic } from './bucketEpic';
import { stripLabel } from '../../lib/todoKind';

describe('isBucketEpic', () => {
  it('matches "Inbox" (case-insensitive)', () => {
    expect(isBucketEpic('Inbox')).toBe(true);
    expect(isBucketEpic('inbox')).toBe(true);
    expect(isBucketEpic('INBOX')).toBe(true);
  });

  it('matches "Bugfix inbox" (case-insensitive)', () => {
    expect(isBucketEpic('Bugfix inbox')).toBe(true);
    expect(isBucketEpic('bugfix inbox')).toBe(true);
    expect(isBucketEpic('BUGFIX INBOX')).toBe(true);
  });

  it('does not match "Inboxing tasks" or "inboxes" — word boundary is load-bearing', () => {
    expect(isBucketEpic('Inboxing tasks')).toBe(false);
    expect(isBucketEpic('inboxes')).toBe(false);
  });

  it('does not match empty string, undefined, or null', () => {
    expect(isBucketEpic('')).toBe(false);
    expect(isBucketEpic(undefined)).toBe(false);
    expect(isBucketEpic(null)).toBe(false);
  });

  it('does not match an ordinary deliverable epic title', () => {
    expect(isBucketEpic('[EPIC] kind column migration')).toBe(false);
    expect(isBucketEpic('kind column migration')).toBe(false);
    expect(isBucketEpic('Deploy to production')).toBe(false);
  });
});

describe('strip-safety: isBucketEpic invariant under stripLabel', () => {
  const bucketTitles = ['[EPIC] Inbox', '[EPIC] Bugfix inbox'];

  bucketTitles.forEach((title) => {
    it(`${title} matches before and after stripLabel`, () => {
      expect(isBucketEpic(title)).toBe(true);
      expect(isBucketEpic(stripLabel(title))).toBe(true);
    });
  });
});
