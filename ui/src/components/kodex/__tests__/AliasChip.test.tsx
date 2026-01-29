import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AliasChip } from '../AliasChip';

describe('AliasChip', () => {
  it('renders the alias text', () => {
    render(<AliasChip alias="auth" />);
    expect(screen.getByText('auth')).toBeInTheDocument();
  });

  it('renders a remove button when onRemove is provided', () => {
    const handleRemove = vi.fn();
    render(<AliasChip alias="auth" onRemove={handleRemove} />);

    const removeButton = screen.getByRole('button');
    expect(removeButton).toBeInTheDocument();
  });

  it('calls onRemove callback when remove button is clicked', async () => {
    const handleRemove = vi.fn();
    const user = userEvent.setup();

    render(<AliasChip alias="auth" onRemove={handleRemove} />);

    const removeButton = screen.getByRole('button');
    await user.click(removeButton);

    expect(handleRemove).toHaveBeenCalledTimes(1);
  });

  it('does not render a remove button when onRemove is not provided', () => {
    render(<AliasChip alias="auth" />);

    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(0);
  });
});
