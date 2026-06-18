import { describe, it, expect } from 'vitest';
import { computeOrderedChips, DEFAULT_CHIPS, type Chip } from './quickReplyStore';

/**
 * computeOrderedChips is the single source of the rail order AND the Ctrl+F#
 * assignment. It must: honour an explicit order, append chips missing from order
 * (migration / newly-added), drop hidden defaults, and stay stable.
 */
describe('checkpoint-reload macro chip', () => {
  it('ships the checkpoint → clear → re-collab sequence with a {{session}} placeholder', () => {
    const chip = DEFAULT_CHIPS.find((c) => c.id === 'checkpoint-reload');
    expect(chip).toBeDefined();
    expect(chip!.sequence).toEqual(['/vibe-checkpoint', '/clear', '/collab {{session}}']);
    // The placeholder is interpolated at click time; the last step must carry it.
    expect(chip!.sequence!.at(-1)).toContain('{{session}}');
  });
});

describe('computeOrderedChips', () => {
  const custom: Chip[] = [{ id: 'c_a', label: 'A' }, { id: 'c_b', label: 'B' }];

  it('migration (empty order) → defaults in code order, then custom', () => {
    const ids = computeOrderedChips(custom, [], []).map((c) => c.id);
    expect(ids).toEqual([...DEFAULT_CHIPS.map((d) => d.id), 'c_a', 'c_b']);
  });

  it('honours an explicit order across defaults + custom', () => {
    const order = ['c_b', 'yes', 'c_a'];
    const ids = computeOrderedChips(custom, [], order).map((c) => c.id);
    // ordered ids first, then any not in `order` appended (defaults then custom).
    expect(ids.slice(0, 3)).toEqual(['c_b', 'yes', 'c_a']);
    expect(ids).toContain('1');
    expect(new Set(ids).size).toBe(ids.length); // no dupes
  });

  it('drops hidden (deleted) defaults', () => {
    const ids = computeOrderedChips(custom, ['1', 'yes'], []).map((c) => c.id);
    expect(ids).not.toContain('1');
    expect(ids).not.toContain('yes');
    expect(ids).toContain('2');
  });

  it('appends a freshly-added custom chip not yet in order', () => {
    const order = DEFAULT_CHIPS.map((d) => d.id); // order predates the custom chips
    const ids = computeOrderedChips(custom, [], order).map((c) => c.id);
    expect(ids.slice(-2)).toEqual(['c_a', 'c_b']);
  });
});
