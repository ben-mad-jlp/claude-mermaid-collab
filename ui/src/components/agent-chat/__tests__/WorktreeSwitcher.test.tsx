import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorktreeSwitcher } from '../WorktreeSwitcher';

const worktrees = [
  { sessionId: 's1', path: '/tmp/wt1', branch: 'feature/a' },
  { sessionId: 's2', path: '/tmp/wt2', branch: 'feature/b' },
  { sessionId: 's3', path: '/tmp/wt3' },
];

describe('WorktreeSwitcher', () => {
  it('renders active worktree branch in pill', () => {
    render(
      <WorktreeSwitcher worktrees={worktrees} activeSessionId="s2" onSwitch={() => {}} />
    );
    const trigger = screen.getByRole('button', { name: /worktree switcher/i });
    expect(trigger).toHaveTextContent('feature/b');
  });

  it('opens list on click showing all worktrees', () => {
    render(
      <WorktreeSwitcher worktrees={worktrees} activeSessionId="s1" onSwitch={() => {}} />
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /worktree switcher/i }));
    const list = screen.getByRole('listbox');
    expect(list).toBeInTheDocument();
    const opts = list.querySelectorAll('[role="option"]');
    expect(opts.length).toBe(3);
    expect(list).toHaveTextContent('feature/a');
    expect(list).toHaveTextContent('feature/b');
    expect(list).toHaveTextContent('/tmp/wt3');
  });

  it('calls onSwitch with selected sessionId when an option is clicked', () => {
    const onSwitch = vi.fn();
    render(
      <WorktreeSwitcher worktrees={worktrees} activeSessionId="s1" onSwitch={onSwitch} />
    );
    fireEvent.click(screen.getByRole('button', { name: /worktree switcher/i }));
    const list = screen.getByRole('listbox');
    const optB = Array.from(list.querySelectorAll('[role="option"]')).find(
      el => el.textContent?.includes('feature/b')
    ) as HTMLElement;
    const btn = optB.querySelector('button') as HTMLElement;
    fireEvent.click(btn);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith('s2');
  });
});
