import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Confirmation } from '../Confirmation';
import { describe, it, expect, vi } from 'vitest';

describe('Confirmation', () => {
  it('renders with message', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        message="Are you sure?"
      />
    );

    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders yes-no buttons by default', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders accept-reject buttons when type is accept-reject', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        type="accept-reject"
      />
    );

    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const confirmButton = screen.getByRole('button', { name: 'Yes' });
    await user.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledOnce();
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const cancelButton = screen.getByRole('button', { name: 'No' });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledOnce();
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm with accept-reject type', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        type="accept-reject"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Accept' });
    await user.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel with accept-reject type', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        type="accept-reject"
      />
    );

    const cancelButton = screen.getByRole('button', { name: 'Reject' });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledOnce();
  });

  it('disables buttons when disabled prop is true', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        disabled
      />
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('does not call callbacks when disabled and clicked', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        disabled
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Yes' });
    const cancelButton = screen.getByRole('button', { name: 'No' });

    await user.click(confirmButton);
    await user.click(cancelButton);

    expect(mockOnConfirm).not.toHaveBeenCalled();
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        ariaLabel="Confirm action"
        message="Delete this item?"
      />
    );

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', 'Confirm action');
  });

  it('associates message with aria-describedby', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        message="Are you sure?"
      />
    );

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-describedby');

    const message = screen.getByText('Are you sure?');
    expect(message).toHaveAttribute('id');
  });

  it('renders without message', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('applies dark mode styles to buttons', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button.className).toContain('dark:');
    });
  });

  it('applies focus styles to buttons', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const confirmButton = screen.getByRole('button', { name: 'Yes' });
    const cancelButton = screen.getByRole('button', { name: 'No' });

    expect(confirmButton.className).toContain('focus:ring-2');
    expect(cancelButton.className).toContain('focus:ring-2');
  });

  it('renders buttons in correct order', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('No');
    expect(buttons[1]).toHaveTextContent('Yes');
  });

  it('preserves button labels on re-render', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    const { rerender } = render(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        message="First message"
      />
    );

    expect(screen.getByText('First message')).toBeInTheDocument();

    rerender(
      <Confirmation
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        message="Second message"
      />
    );

    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('has proper button styling', () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    render(<Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />);

    const confirmButton = screen.getByRole('button', { name: 'Yes' });
    const cancelButton = screen.getByRole('button', { name: 'No' });

    expect(confirmButton.className).toContain('bg-blue-600');
    expect(confirmButton.className).toContain('text-white');
    expect(cancelButton.className).toContain('border');
  });

  it('handles rapid button clicks', async () => {
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <Confirmation onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    const confirmButton = screen.getByRole('button', { name: 'Yes' });
    const cancelButton = screen.getByRole('button', { name: 'No' });

    await user.click(confirmButton);
    await user.click(cancelButton);

    expect(mockOnConfirm).toHaveBeenCalledOnce();
    expect(mockOnCancel).toHaveBeenCalledOnce();
  });
});
