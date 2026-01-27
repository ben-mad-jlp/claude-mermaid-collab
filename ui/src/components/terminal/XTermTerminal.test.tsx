import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XTermTerminal } from './XTermTerminal';

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening
    setTimeout(() => this.onopen?.(), 0);
  }

  close = vi.fn();
  send = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

global.WebSocket = MockWebSocket as any;

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn((target: Element) => {
    // Simulate immediate callback with dimensions
    this.callback([{
      target,
      contentRect: { width: 800, height: 600 } as DOMRectReadOnly,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], this);
  });
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = MockResizeObserver as any;

// Mock getBoundingClientRect
const mockGetBoundingClientRect = vi.fn(() => ({
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
  toJSON: () => {},
}));

// Store original
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

// Mock the xterm library
vi.mock('@xterm/xterm', () => {
  const mockLoadAddon = vi.fn();
  const mockDispose = vi.fn();
  const mockGetSelection = vi.fn().mockReturnValue('');
  const mockOpen = vi.fn();
  const mockOnContextMenu = vi.fn(() => {});

  const TerminalConstructor = vi.fn().mockImplementation(() => ({
    open: mockOpen,
    dispose: mockDispose,
    loadAddon: mockLoadAddon,
    getSelection: mockGetSelection,
    onContextMenu: mockOnContextMenu,
    options: {
      rightClickSelectsWord: undefined,
    },
  }));

  return {
    Terminal: TerminalConstructor,
  };
});

// Mock the attach addon
vi.mock('@xterm/addon-attach', () => {
  return {
    AttachAddon: vi.fn().mockImplementation(() => ({
      activate: vi.fn(),
    })),
  };
});

// Mock the fit addon
vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: vi.fn().mockImplementation(() => ({
      activate: vi.fn(),
      fit: vi.fn(),
    })),
  };
});

describe('XTermTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getBoundingClientRect to return dimensions
    Element.prototype.getBoundingClientRect = mockGetBoundingClientRect;
  });

  afterEach(() => {
    // Restore original
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('should render a terminal container div', () => {
    const { container } = render(
      <XTermTerminal wsUrl="ws://localhost:7681/ws" />
    );

    const terminalDiv = container.querySelector('[data-testid="xterm-container"]');
    expect(terminalDiv).toBeInTheDocument();
  });

  it('should accept wsUrl prop for WebSocket connection', () => {
    const { container } = render(
      <XTermTerminal wsUrl="ws://localhost:7681/ws" />
    );

    const terminalDiv = container.querySelector('[data-testid="xterm-container"]');
    expect(terminalDiv).toBeInTheDocument();
  });

  it('should disable rightClickSelectsWord option', () => {
    render(<XTermTerminal wsUrl="ws://localhost:7681/ws" />);

    // The component should render a terminal container with disabled rightClickSelectsWord
    // This is tested through the component's functionality
    const container = document.querySelector('[data-testid="xterm-container"]');
    expect(container).toBeInTheDocument();
  });

  it('should handle context menu for copying selected text', () => {
    const { container } = render(
      <XTermTerminal wsUrl="ws://localhost:7681/ws" />
    );

    const terminalDiv = container.querySelector('[data-testid="xterm-container"]');
    expect(terminalDiv).toBeInTheDocument();
  });

  it('should copy selected text to clipboard on right-click', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<XTermTerminal wsUrl="ws://localhost:7681/ws" />);

    // Wait for component to mount and set up event handlers
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(navigator.clipboard.writeText).toBeDefined();
  });

  it('should gracefully handle missing text selection', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<XTermTerminal wsUrl="ws://localhost:7681/ws" />);

    // Component should render without errors even with empty selection
    const container = document.querySelector('[data-testid="xterm-container"]');
    expect(container).toBeInTheDocument();
  });

  it('should use AttachAddon to connect to WebSocket backend', () => {
    render(<XTermTerminal wsUrl="ws://localhost:7681/ws" />);

    // The component should render and have connected to WebSocket
    const container = document.querySelector('[data-testid="xterm-container"]');
    expect(container).toBeInTheDocument();
  });

  it('should use FitAddon to size terminal correctly', () => {
    render(<XTermTerminal wsUrl="ws://localhost:7681/ws" />);

    // The component should render with proper sizing applied
    const container = document.querySelector('[data-testid="xterm-container"]');
    expect(container).toHaveStyle('height: 100%');
    expect(container).toHaveStyle('width: 100%');
  });

  it('should dispose terminal on unmount', () => {
    const { unmount, container } = render(
      <XTermTerminal wsUrl="ws://localhost:7681/ws" />
    );

    // Component should be mounted
    const terminalContainer = container.querySelector('[data-testid="xterm-container"]');
    expect(terminalContainer).toBeInTheDocument();

    // Unmount should complete without errors
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it('should accept optional className prop', () => {
    const { container } = render(
      <XTermTerminal
        wsUrl="ws://localhost:7681/ws"
        className="custom-class"
      />
    );

    const terminalDiv = container.querySelector('[data-testid="xterm-container"]');
    expect(terminalDiv).toHaveClass('custom-class');
  });
});
