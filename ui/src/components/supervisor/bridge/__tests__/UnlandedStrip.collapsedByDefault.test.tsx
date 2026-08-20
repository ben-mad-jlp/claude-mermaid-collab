import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { UnlandedStrip } from '../UnlandedStrip';

describe('UnlandedStrip collapsed by default', () => {
  const epics = [
    { branch: 'collab/epic/aa11bb22', epicId8: 'aa11bb22', ahead: 2 },
    { branch: 'collab/epic/cc33dd44', epicId8: 'cc33dd44', ahead: 5 },
  ];

  it('collapses the epic list on first render while keeping the header count visible', () => {
    const { queryByTestId, getByText, container } = render(
      <UnlandedStrip unlandedEpics={epics} />
    );

    expect(queryByTestId('unlanded-epics-list')).toBeNull();
    expect(getByText(/2 epics unlanded/)).toBeDefined();
    const headerButton = container.querySelector('button[aria-expanded]');
    expect(headerButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands the epic list when the header button is clicked', () => {
    const { getByTestId, container } = render(
      <UnlandedStrip unlandedEpics={epics} />
    );

    const headerButton = container.querySelector('button[aria-expanded]');
    fireEvent.click(headerButton!);

    const list = getByTestId('unlanded-epics-list');
    expect(list.textContent).toContain('collab/epic/aa11bb22');
    expect(list.textContent).toContain('collab/epic/cc33dd44');
  });
});
