import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnRail } from '../TurnRail';

describe('TurnRail', () => {
  const turns = [
    { id: 't1', label: 'Turn 1' },
    { id: 't2', label: 'Turn 2' },
    { id: 't3', label: 'Turn 3' },
  ];

  it('renders a dot for each turn', () => {
    render(<TurnRail turns={turns} onJump={() => {}} />);
    const dots = screen.getAllByRole('button');
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('data-turn-id', 't1');
    expect(dots[1]).toHaveAttribute('data-turn-id', 't2');
    expect(dots[2]).toHaveAttribute('data-turn-id', 't3');
  });

  it('highlights the active turn', () => {
    render(<TurnRail turns={turns} activeTurnId="t2" onJump={() => {}} />);
    const active = screen.getByRole('button', { name: 'Turn 2' });
    const inactive = screen.getByRole('button', { name: 'Turn 1' });
    expect(active).toHaveAttribute('data-active', 'true');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active.className).toMatch(/blue/);
    expect(inactive).toHaveAttribute('data-active', 'false');
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('calls onJump with turn id on click', () => {
    const onJump = vi.fn();
    render(<TurnRail turns={turns} onJump={onJump} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn 3' }));
    expect(onJump).toHaveBeenCalledWith('t3');
    fireEvent.click(screen.getByRole('button', { name: 'Turn 1' }));
    expect(onJump).toHaveBeenCalledWith('t1');
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it('uses sticky positioning', () => {
    const { container } = render(<TurnRail turns={turns} onJump={() => {}} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/sticky/);
  });

  it('falls back to default label when none provided', () => {
    render(<TurnRail turns={[{ id: 'abc' }]} onJump={() => {}} />);
    expect(screen.getByRole('button', { name: 'Turn abc' })).toBeInTheDocument();
  });
});
