import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the EmbeddedTerminal so we test the real component (not the global mock)
vi.unmock('@/components/EmbeddedTerminal');

import { EmbeddedTerminal } from './EmbeddedTerminal';

describe('EmbeddedTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render start button initially', () => {
    render(<EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />);
    expect(screen.getByText('Start Terminal')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://localhost:7681/ws' }}
        className="custom-class"
      />
    );
    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toHaveClass('custom-class');
  });

  it('should show iframe when started', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );

    const startButton = screen.getByText('Start Terminal');
    fireEvent.click(startButton);

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'http://localhost:7681');
  });

  it('should keep iframe visible once started', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );

    fireEvent.click(screen.getByText('Start Terminal'));
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });
});
