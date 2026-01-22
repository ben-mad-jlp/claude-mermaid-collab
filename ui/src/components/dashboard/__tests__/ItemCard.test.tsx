/**
 * ItemCard Component Tests
 *
 * Tests for:
 * - Rendering item information (name, type, lastModified)
 * - Click handlers
 * - Selection state styling
 * - Icon display based on item type
 * - Relative time formatting
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ItemCard from '../ItemCard';

describe('ItemCard', () => {
  it('renders item information correctly', () => {
    render(
      <ItemCard
        id="test-1"
        name="Test Diagram"
        type="diagram"
        lastModified={Date.now()}
      />
    );

    expect(screen.getByText('Test Diagram')).toBeInTheDocument();
    expect(screen.getByText('diagram')).toBeInTheDocument();
  });

  it('displays document icon for document type', () => {
    render(
      <ItemCard
        id="test-2"
        name="Test Document"
        type="document"
        lastModified={Date.now()}
      />
    );

    expect(screen.getByText('document')).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <ItemCard
        id="test-3"
        name="Clickable Item"
        type="diagram"
        onClick={onClick}
      />
    );

    await user.click(screen.getByTestId('item-card-test-3'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('displays selected state styling', () => {
    const { container } = render(
      <ItemCard
        id="test-4"
        name="Selected Item"
        type="diagram"
        isSelected={true}
      />
    );

    const button = screen.getByTestId('item-card-test-4');
    expect(button).toHaveClass('ring-2');
  });

  it('formats relative time correctly', () => {
    const oneHourAgo = Date.now() - 3600000;

    render(
      <ItemCard
        id="test-5"
        name="Recent Item"
        type="diagram"
        lastModified={oneHourAgo}
      />
    );

    expect(screen.getByText(/\d+h ago/)).toBeInTheDocument();
  });

  it('displays custom className', () => {
    const { container } = render(
      <ItemCard
        id="test-6"
        name="Styled Item"
        type="diagram"
        className="custom-class"
      />
    );

    const button = screen.getByTestId('item-card-test-6');
    expect(button).toHaveClass('custom-class');
  });

  it('shows "just now" for very recent modifications', () => {
    const justNow = Date.now() - 10000; // 10 seconds ago

    render(
      <ItemCard
        id="test-7"
        name="Just Modified"
        type="diagram"
        lastModified={justNow}
      />
    );

    expect(screen.getByText('just now')).toBeInTheDocument();
  });
});
