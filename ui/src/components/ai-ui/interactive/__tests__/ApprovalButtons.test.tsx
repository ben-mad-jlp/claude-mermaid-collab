import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalButtons, ApprovalAction } from '../ApprovalButtons';
import { describe, it, expect, vi } from 'vitest';

describe('ApprovalButtons Component', () => {
  const mockActions: ApprovalAction[] = [
    {
      id: 'reject',
      label: 'Reject',
      destructive: true,
    },
    {
      id: 'approve',
      label: 'Approve',
      primary: true,
    },
  ];

  it('should render all actions', () => {
    render(<ApprovalButtons actions={mockActions} />);

    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('should call onAction with correct action id when button is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ApprovalButtons actions={mockActions} onAction={onAction} />);

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    await user.click(approveButton);

    expect(onAction).toHaveBeenCalledWith('approve');
  });

  it('should apply primary button styling', () => {
    const { container } = render(<ApprovalButtons actions={mockActions} />);

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    expect(approveButton).toHaveClass('bg-blue-600');
  });

  it('should apply destructive button styling', () => {
    const { container } = render(<ApprovalButtons actions={mockActions} />);

    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    expect(rejectButton).toHaveClass('bg-red-600');
  });

  it('should apply left alignment', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} alignment="left" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('justify-start');
  });

  it('should apply right alignment', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} alignment="right" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('justify-end');
  });

  it('should apply center alignment', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} alignment="center" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('justify-center');
  });

  it('should apply compact spacing', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} spacing="compact" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('gap-2');
  });

  it('should apply normal spacing', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} spacing="normal" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('gap-3');
  });

  it('should apply spacious spacing', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} spacing="spacious" />
    );

    const wrapper = container.querySelector('.approval-buttons');
    expect(wrapper).toHaveClass('gap-6');
  });

  it('should apply full width when enabled', () => {
    const { container } = render(
      <ApprovalButtons actions={mockActions} fullWidth={true} />
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveClass('flex-1');
    });
  });

  it('should disable all buttons when disabled prop is true', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ApprovalButtons actions={mockActions} disabled={true} onAction={onAction} />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();

    await user.click(buttons[0]);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('should show loading state', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(() => {
      // Simulate async action
    });

    render(<ApprovalButtons actions={mockActions} onAction={onAction} />);

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    await user.click(approveButton);

    // Button should be disabled during loading
    expect(approveButton).toBeDisabled();
  });

  it('should apply default button styling for non-primary, non-destructive actions', () => {
    const defaultActions: ApprovalAction[] = [
      {
        id: 'maybe',
        label: 'Maybe',
      },
    ];

    const { container } = render(<ApprovalButtons actions={defaultActions} />);

    const maybeButton = screen.getByRole('button', { name: 'Maybe' });
    expect(maybeButton).toHaveClass('bg-gray-200');
  });

  it('should handle single action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const singleAction: ApprovalAction[] = [
      {
        id: 'action',
        label: 'Single Action',
        primary: true,
      },
    ];

    render(<ApprovalButtons actions={singleAction} onAction={onAction} />);

    const button = screen.getByRole('button', { name: 'Single Action' });
    await user.click(button);

    expect(onAction).toHaveBeenCalledWith('action');
  });

  it('should handle multiple actions', () => {
    const multipleActions: ApprovalAction[] = [
      { id: 'action1', label: 'Action 1' },
      { id: 'action2', label: 'Action 2' },
      { id: 'action3', label: 'Action 3' },
    ];

    render(<ApprovalButtons actions={multipleActions} />);

    expect(screen.getByRole('button', { name: 'Action 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action 3' })).toBeInTheDocument();
  });

  it('should have proper ARIA attributes', () => {
    render(<ApprovalButtons actions={mockActions} disabled={false} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('aria-disabled');
    });
  });

  it('should have focus ring on focus', () => {
    const { container } = render(<ApprovalButtons actions={mockActions} />);

    const button = screen.getByRole('button', { name: 'Approve' });
    expect(button).toHaveClass('focus:ring-2');
  });
});
