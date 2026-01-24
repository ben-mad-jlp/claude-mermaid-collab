import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';

// Mock the components
vi.mock('../MessageArea', () => ({
  MessageArea: ({ content }: any) => <div data-testid="message-area">{content}</div>,
}));

vi.mock('../EmbeddedTerminal', () => ({
  EmbeddedTerminal: ({ config }: any) => (
    <div data-testid="embedded-terminal">{config.wsUrl}</div>
  ),
}));

describe('WorkspacePanel', () => {
  it('should render WorkspacePanel container', () => {
    const { container } = render(
      <WorkspacePanel
        messageContent="Test message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    const panel = container.querySelector('[data-testid="workspace-panel"]');
    expect(panel).toBeInTheDocument();
  });

  it('should render MessageArea component', () => {
    render(
      <WorkspacePanel
        messageContent="Test message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    expect(screen.getByTestId('message-area')).toBeInTheDocument();
  });

  it('should render EmbeddedTerminal component', () => {
    render(
      <WorkspacePanel
        messageContent="Test message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    expect(screen.getByTestId('embedded-terminal')).toBeInTheDocument();
  });

  it('should display message content in MessageArea', () => {
    render(
      <WorkspacePanel
        messageContent="Custom message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    expect(screen.getByText('Custom message')).toBeInTheDocument();
  });

  it('should pass correct terminal config to EmbeddedTerminal', () => {
    render(
      <WorkspacePanel
        messageContent="Test"
        terminalConfig={{
          wsUrl: 'ws://localhost:7681/ws',
          fontSize: 16,
        }}
      />
    );
    const terminal = screen.getByTestId('embedded-terminal');
    expect(terminal).toHaveTextContent('ws://localhost:7681/ws');
  });

  it('should use vertical flex layout', () => {
    const { container } = render(
      <WorkspacePanel
        messageContent="Test message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    const panel = container.querySelector('[data-testid="workspace-panel"]') as HTMLElement;
    const styles = window.getComputedStyle(panel);
    expect(styles.display).toBe('flex');
    expect(styles.flexDirection).toBe('column');
  });

  it('should allocate 1/3 height to MessageArea and 2/3 to Terminal', () => {
    const { container } = render(
      <WorkspacePanel
        messageContent="Test message"
        terminalConfig={{ wsUrl: 'ws://localhost:7681/ws' }}
      />
    );
    const messageAreaWrapper = container.querySelector('[data-testid="message-area"]')?.parentElement as HTMLElement;
    const terminalWrapper = container.querySelector('[data-testid="embedded-terminal"]')?.parentElement as HTMLElement;

    // Check inline flex properties (they expand to flex-grow, flex-shrink, flex-basis)
    expect(messageAreaWrapper?.style.flex).toContain('1');
    expect(terminalWrapper?.style.flex).toContain('2');
  });
});
