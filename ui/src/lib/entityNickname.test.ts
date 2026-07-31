import { describe, it, expect } from 'vitest';
import { displayLabel, humanizeIds } from './entityNickname';

const FULL_UUID = '12345678-90ab-cdef-1234-567890abcdef';

describe('displayLabel', () => {
  it('displayLabel returns the nickname when present', () => {
    const result = displayLabel(FULL_UUID, { [FULL_UUID]: 'happy-otter' });
    expect(result).toBe('happy-otter');
  });

  it('displayLabel falls back to the leading-8 short id when no nickname is known', () => {
    const result = displayLabel(FULL_UUID, {});
    expect(result).not.toBe(FULL_UUID);
    expect(result).toBe(FULL_UUID.slice(0, 8));
  });

  it('displayLabel falls back to the leading-8 short id when nicknames is undefined', () => {
    const result = displayLabel(FULL_UUID);
    expect(result).toBe(FULL_UUID.slice(0, 8));
  });
});

describe('humanizeIds', () => {
  it('humanizeIds leaves an unknown id untouched', () => {
    const otherUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const text = `see ${FULL_UUID} and ${otherUuid}`;
    const result = humanizeIds(text, { [FULL_UUID]: 'happy-otter' });
    expect(result).toBe(`see happy-otter and ${otherUuid}`);
  });

  it('humanizeIds returns text unchanged when nicknames is undefined', () => {
    const text = `see ${FULL_UUID}`;
    expect(humanizeIds(text)).toBe(text);
  });

  it('humanizeIds replaces a crit_ criterion-id token with its nickname', () => {
    const critId = 'crit_12345678_3_lz9x2k';
    const text = `blocked on ${critId}`;
    const result = humanizeIds(text, { [critId]: 'brave-otter' });
    expect(result).toBe('blocked on brave-otter');
  });

  it('humanizeIds leaves an unmapped crit_ token verbatim', () => {
    const critId = 'crit_12345678_3_lz9x2k';
    const text = `blocked on ${critId}`;
    const result = humanizeIds(text, {});
    expect(result).toBe(text);
  });

  it('humanizeIds resolves a UUID and a crit_ token in the same string independently', () => {
    const critId = 'crit_12345678_3_lz9x2k';
    const text = `see ${FULL_UUID} and ${critId}`;
    const result = humanizeIds(text, { [FULL_UUID]: 'happy-otter', [critId]: 'brave-otter' });
    expect(result).toBe('see happy-otter and brave-otter');
  });
});
