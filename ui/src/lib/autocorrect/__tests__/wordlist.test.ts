import { describe, it, expect } from 'vitest';
import { COMMON_TYPOS, PROTECTED_VALID_WORDS, loadCommonWords } from '../wordlist';
import words from '../common-words-en.json';

describe('COMMON_TYPOS', () => {
  it('maps teh -> the', () => expect(COMMON_TYPOS['teh']).toBe('the'));
  it('maps recieve -> receive', () => expect(COMMON_TYPOS['recieve']).toBe('receive'));
});

describe('loadCommonWords', () => {
  it('returns a Set with core words', async () => {
    const set = await loadCommonWords();
    expect(set.has('the')).toBe(true);
    expect(set.has('receive')).toBe(true);
    expect(set.has('believe')).toBe(true);
  });
});

describe('common-words-en.json', () => {
  it('has at least 300 entries', () => expect((words as string[]).length).toBeGreaterThanOrEqual(300));
});

describe('valid-word guard', () => {
  it('your is not in COMMON_TYPOS', () => {
    expect(!('your' in COMMON_TYPOS)).toBe(true);
  });

  it('its is not in COMMON_TYPOS', () => {
    expect(!('its' in COMMON_TYPOS)).toBe(true);
  });

  it('all PROTECTED_VALID_WORDS are disjoint from COMMON_TYPOS keys', () => {
    for (const w of PROTECTED_VALID_WORDS) {
      expect(w in COMMON_TYPOS).toBe(false);
    }
  });
});
