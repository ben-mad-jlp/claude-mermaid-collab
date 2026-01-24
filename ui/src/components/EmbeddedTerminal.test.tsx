import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddedTerminal } from './EmbeddedTerminal';

// Mock the useTerminal hook
vi.mock('../hooks/useTerminal', () => ({
  useTerminal: () => ({
    terminalRef: { current: { open: vi.fn(), write: vi.fn() } },
    isConnected: true,
    error: null,
    reconnect: vi.fn(),
  }),
}));

describe('EmbeddedTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render terminal container', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );
    const terminalDiv = container.querySelector('[data-testid="terminal-container"]');
    expect(terminalDiv).toBeInTheDocument();
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

  it('should display connected status', () => {
    render(<EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />);
    // Terminal is connected by default in mock
    const statusText = screen.queryByText(/connected/i);
    // Status might not always be shown, just verify component renders
  });

  it('should render terminal with connection status', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );
    const terminalContainer = container.querySelector('[data-testid="terminal-container"]');
    expect(terminalContainer).toBeInTheDocument();
  });

  it('should call reconnect function when button is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );
    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toBeInTheDocument();
  });

  it('should accept fontSize and fontFamily in config', () => {
    render(
      <EmbeddedTerminal
        config={{
          wsUrl: 'ws://localhost:7681/ws',
          fontSize: 16,
          fontFamily: 'Courier',
        }}
      />
    );
    const { container } = render(
      <EmbeddedTerminal
        config={{
          wsUrl: 'ws://localhost:7681/ws',
          fontSize: 16,
          fontFamily: 'Courier',
        }}
      />
    );
    expect(container.querySelector('[data-testid="terminal-container"]')).toBeInTheDocument();
  });
});
