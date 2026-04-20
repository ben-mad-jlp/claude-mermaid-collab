import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnFooter } from '../TurnFooter';

describe('TurnFooter', () => {
  it('renders all fields: tokens, cost, elapsed, stop reason', () => {
    render(
      <TurnFooter
        usage={{ inputTokens: 1234, outputTokens: 567, costUsd: 0.0123 }}
        stopReason="end_turn"
        elapsedMs={2500}
      />,
    );
    expect(screen.getByText('1234 in')).toBeInTheDocument();
    expect(screen.getByText('567 out')).toBeInTheDocument();
    expect(screen.getByText('$0.0123')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    expect(screen.getByText('end_turn')).toBeInTheDocument();
  });

  it('handles missing cost', () => {
    render(
      <TurnFooter
        usage={{ inputTokens: 10, outputTokens: 20 }}
        stopReason="end_turn"
        elapsedMs={1000}
      />,
    );
    expect(screen.getByText('10 in')).toBeInTheDocument();
    expect(screen.getByText('20 out')).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
    expect(screen.getByText('1.0s')).toBeInTheDocument();
    expect(screen.getByText('end_turn')).toBeInTheDocument();
  });

  it('shows canceled state in red', () => {
    render(
      <TurnFooter
        usage={{ inputTokens: 5, outputTokens: 5 }}
        canceled
        elapsedMs={500}
      />,
    );
    const canceled = screen.getByText('canceled');
    expect(canceled).toBeInTheDocument();
    expect(canceled.className).toMatch(/red/);
  });

  it('applies muted style', () => {
    const { container } = render(
      <TurnFooter usage={{ inputTokens: 1, outputTokens: 1 }} elapsedMs={100} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/text-gray-500|text-gray-400/);
    expect(root.className).toMatch(/text-xs/);
  });

  it('renders nothing when no data and not canceled', () => {
    const { container } = render(<TurnFooter />);
    expect(container.firstChild).toBeNull();
  });
});
