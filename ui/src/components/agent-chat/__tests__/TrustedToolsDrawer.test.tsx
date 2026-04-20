import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrustedToolsDrawer } from '../TrustedToolsDrawer';
import { useAgentStore } from '../../../stores/agentStore';

describe('TrustedToolsDrawer', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders list of trusted tools when open', () => {
    useAgentStore.getState().setTrustedTools(['Bash(git status)', 'Read', 'Edit']);
    render(
      <TrustedToolsDrawer open={true} onClose={() => {}} onRevoke={() => {}} />,
    );
    expect(screen.getByText('Bash(git status)')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('renders empty state when no trusted tools', () => {
    render(
      <TrustedToolsDrawer open={true} onClose={() => {}} onRevoke={() => {}} />,
    );
    expect(screen.getByText(/No tools trusted/i)).toBeInTheDocument();
  });

  it('calls onRevoke with the tool name when Revoke clicked', () => {
    useAgentStore.getState().setTrustedTools(['Read', 'Edit']);
    const onRevoke = vi.fn();
    render(
      <TrustedToolsDrawer open={true} onClose={() => {}} onRevoke={onRevoke} />,
    );
    const btn = screen.getByRole('button', { name: /Revoke Read/ });
    fireEvent.click(btn);
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledWith('Read');
  });

  it('calls onClose when close button clicked', () => {
    useAgentStore.getState().setTrustedTools(['Read']);
    const onClose = vi.fn();
    render(
      <TrustedToolsDrawer open={true} onClose={onClose} onRevoke={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close trusted tools drawer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides drawer when closed', () => {
    useAgentStore.getState().setTrustedTools(['Read']);
    const { container } = render(
      <TrustedToolsDrawer open={false} onClose={() => {}} onRevoke={() => {}} />,
    );
    expect(screen.queryByTestId('trusted-tools-drawer')).toBeNull();
    expect(screen.queryByText('Read')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
