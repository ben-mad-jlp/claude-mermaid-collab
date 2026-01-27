import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TerminalConfig } from '../../types/terminal';

// Unmock EmbeddedTerminal for this test suite since we're testing it directly
vi.unmock('@/components/EmbeddedTerminal');

// Import after unmocking
import { EmbeddedTerminal } from '../EmbeddedTerminal';

// Mock the XTermTerminal component to avoid xterm initialization in tests
vi.mock('../terminal/XTermTerminal', () => ({
  XTermTerminal: ({ wsUrl, className }: { wsUrl: string; className?: string }) => (
    <div data-testid="xterm-component" data-ws-url={wsUrl} className={className} />
  ),
}));

describe('EmbeddedTerminal', () => {
  const mockConfig: TerminalConfig = {
    wsUrl: 'ws://localhost:7681/ws',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('should render the XTermTerminal component', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
      );
      expect(getByTestId('xterm-component')).toBeInTheDocument();
    });

    it('should pass WebSocket URL to XTermTerminal', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
      );
      const xtermComponent = getByTestId('xterm-component');
      expect(xtermComponent).toHaveAttribute('data-ws-url', 'ws://localhost:7681/ws');
    });

    it('should apply className prop to XTermTerminal', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal
          config={mockConfig}
          sessionName="test-session"
          className="custom-terminal-class"
        />
      );
      const xtermComponent = getByTestId('xterm-component');
      expect(xtermComponent).toHaveClass('custom-terminal-class');
    });

    it('should render container div with embedded-terminal class', () => {
      const { container } = render(
        <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
      );
      const containerDiv = container.querySelector('.embedded-terminal');
      expect(containerDiv).toBeInTheDocument();
    });

    it('should NOT render an iframe element', () => {
      const { container } = render(
        <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
      );
      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should handle missing sessionName prop', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal config={mockConfig} />
      );
      expect(getByTestId('xterm-component')).toBeInTheDocument();
    });

    it('should handle empty className prop', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal
          config={mockConfig}
          sessionName="test-session"
          className=""
        />
      );
      const xtermComponent = getByTestId('xterm-component');
      expect(xtermComponent).toBeInTheDocument();
    });

    it('should pass config.wsUrl directly to XTermTerminal', () => {
      const customWsUrl = 'ws://custom-host:8765/ws';
      const customConfig: TerminalConfig = {
        wsUrl: customWsUrl,
      };
      const { getByTestId } = render(
        <EmbeddedTerminal config={customConfig} sessionName="test-session" />
      );
      const xtermComponent = getByTestId('xterm-component');
      expect(xtermComponent).toHaveAttribute('data-ws-url', customWsUrl);
    });
  });

  describe('Error Handling', () => {
    it('should render without error when config is provided', () => {
      expect(() => {
        render(
          <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
        );
      }).not.toThrow();
    });

    it('should render without error with all props provided', () => {
      expect(() => {
        render(
          <EmbeddedTerminal
            config={mockConfig}
            sessionName="test-session"
            className="test-class"
          />
        );
      }).not.toThrow();
    });
  });

  describe('Imports and Dependencies', () => {
    it('should use XTermTerminal component internally', () => {
      const { getByTestId } = render(
        <EmbeddedTerminal config={mockConfig} sessionName="test-session" />
      );
      // If XTermTerminal is used, the mocked component should be rendered
      expect(getByTestId('xterm-component')).toBeInTheDocument();
    });
  });
});
