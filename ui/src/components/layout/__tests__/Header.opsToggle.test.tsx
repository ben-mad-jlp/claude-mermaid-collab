/**
 * Header Ops Toggle Removal Test
 *
 * Verifies that the Ops toggle pill has been removed from the Header component.
 * Tests confirm the button, aria-label, and span text are no longer present.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { Header } from '../Header';

function wrapHeader(props: Parameters<typeof Header>[0]) {
  return (
    <MemoryRouter>
      <Header {...props} />
    </MemoryRouter>
  );
}

describe('Header - Ops Toggle Removal', () => {
  it('should not render the toggle-zen testid', () => {
    render(wrapHeader({}));
    expect(screen.queryByTestId('toggle-zen')).toBeNull();
  });

  it('should not render the Toggle Ops screen aria-label', () => {
    render(wrapHeader({}));
    expect(screen.queryByLabelText('Toggle Ops screen')).toBeNull();
  });

  it('should not render the Ops span text', () => {
    render(wrapHeader({}));
    expect(screen.queryByText('Ops', { selector: 'span' })).toBeNull();
  });
});
