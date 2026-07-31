import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityChip } from './EntityChip';

const FULL_UUID = '12345678-90ab-cdef-1234-567890abcdef';

describe('EntityChip', () => {
  it('EntityChip renders the nickname as visible text', () => {
    render(
      <EntityChip
        kind="epic"
        id={FULL_UUID}
        nicknames={{ [FULL_UUID]: 'happy-otter' }}
        onOpen={() => {}}
      />
    );
    expect(screen.getByTestId(`entity-chip-epic-${FULL_UUID}`)).toHaveTextContent('happy-otter');
  });

  it('EntityChip carries the full raw id in data-entity-id and title', () => {
    render(
      <EntityChip
        kind="epic"
        id={FULL_UUID}
        nicknames={{ [FULL_UUID]: 'happy-otter' }}
        onOpen={() => {}}
      />
    );
    const button = screen.getByTestId(`entity-chip-epic-${FULL_UUID}`);
    expect(button.getAttribute('data-entity-id')).toBe(FULL_UUID);
    expect(button.getAttribute('title')).toBe(FULL_UUID);
  });

  it('EntityChip click calls onOpen with the full raw id', () => {
    const onOpen = vi.fn();
    render(
      <EntityChip
        kind="epic"
        id={FULL_UUID}
        nicknames={{ [FULL_UUID]: 'happy-otter' }}
        onOpen={onOpen}
      />
    );
    fireEvent.click(screen.getByTestId(`entity-chip-epic-${FULL_UUID}`));
    expect(onOpen).toHaveBeenCalledWith('epic', FULL_UUID);
  });
});
