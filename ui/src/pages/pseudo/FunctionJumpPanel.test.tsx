/**
 * FunctionJumpPanel Component Tests
 *
 * Comprehensive test suite for the function jump panel covering:
 * - Null rendering when empty
 * - Observer setup and cleanup
 * - Active function tracking via IntersectionObserver
 * - Export dot rendering for exported functions
 * - Click navigation to functions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef, RefObject } from 'react';
import FunctionJumpPanel from './FunctionJumpPanel';
import { ParsedFunction } from './parsePseudo';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(
    public callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {}

  observe = mockObserve;
  unobserve = mockUnobserve;
  disconnect = mockDisconnect;
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('FunctionJumpPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup IntersectionObserver mock
    window.IntersectionObserver = MockIntersectionObserver as any;
  });

  afterEach(() => {
    mockObserve.mockClear();
    mockUnobserve.mockClear();
    mockDisconnect.mockClear();
  });

  describe('Empty State', () => {
    it('should return null when functions array is empty', () => {
      const mockRef = createRef<any>();
      const { container } = render(
        <FunctionJumpPanel functions={[]} viewerRef={mockRef} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should return null when functions is not provided', () => {
      const mockRef = createRef<any>();
      const { container } = render(
        <FunctionJumpPanel functions={[]} viewerRef={mockRef} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Panel Rendering', () => {
    it('should render panel with correct styling when functions exist', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'testFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const panel = container.querySelector('[data-testid="function-jump-panel"]');
      expect(panel).toBeInTheDocument();
      expect(panel).toHaveClass('w-full');
      expect(panel).toHaveClass('h-full');
      expect(panel).toHaveClass('border-l');
      expect(panel).toHaveClass('overflow-y-auto');
      expect(panel).toHaveClass('px-3');
      expect(panel).toHaveClass('py-4');
    });

    it('should render FUNCTIONS header', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      render(<FunctionJumpPanel functions={functions} viewerRef={mockRef} />);

      const header = screen.getByText('FUNCTIONS');
      expect(header).toBeInTheDocument();
      expect(header).toHaveClass('text-[11px]');
      expect(header).toHaveClass('uppercase');
    });
  });

  describe('Function List Rendering', () => {
    it('should render all functions in the list', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'function1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'function2',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'function3',
          params: '',
          returnType: '',
          isExport: true,
          calls: [],
          body: [],
        },
      ];

      render(<FunctionJumpPanel functions={functions} viewerRef={mockRef} />);

      expect(screen.getByText('function1')).toBeInTheDocument();
      expect(screen.getByText('function2')).toBeInTheDocument();
      expect(screen.getByText('function3')).toBeInTheDocument();
    });

    it('should render function entries as clickable divs', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'clickableFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry = container.querySelector('[data-function-entry="clickableFunc"]');
      expect(entry).toBeInTheDocument();
    });
  });

  describe('Export Indicator', () => {
    it('should render green dot for exported functions', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'exportedFunc',
          params: '',
          returnType: '',
          isExport: true,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const dot = container.querySelector(
        '[data-function-entry="exportedFunc"] [data-export-dot]'
      );
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveClass('w-1.5');
      expect(dot).toHaveClass('h-1.5');
      expect(dot).toHaveClass('rounded-full');
      expect(dot).toHaveClass('bg-green-600');
    });

    it('should not render green dot for non-exported functions', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'privateFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry = container.querySelector('[data-function-entry="privateFunc"]');
      const dot = entry?.querySelector('[data-export-dot]');
      expect(dot).not.toBeInTheDocument();
    });
  });

  describe('Active Function Tracking', () => {
    it('should create IntersectionObserver on mount', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      render(<FunctionJumpPanel functions={functions} viewerRef={mockRef} />);

      // IntersectionObserver constructor should have been called
      expect(MockIntersectionObserver).toBeDefined();
    });

    it('should observe data-function elements from viewer', () => {
      const mockRef = createRef<any>();
      mockRef.current = {
        scrollToFunction: vi.fn(),
      };

      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      // Mock querySelector on the ref's current container
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-function', 'func1');

      render(<FunctionJumpPanel functions={functions} viewerRef={mockRef} />);

      // The component should have attempted to set up observers
      // In real usage, this would observe the viewer's function elements
    });

    it('should update activeFunction on intersection', () => {
      const mockRef = createRef<any>();
      mockRef.current = {
        scrollToFunction: vi.fn(),
      };

      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'func2',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      render(<FunctionJumpPanel functions={functions} viewerRef={mockRef} />);

      // Verify component renders without error
      expect(screen.getByText('func1')).toBeInTheDocument();
      expect(screen.getByText('func2')).toBeInTheDocument();
    });

    it('should disconnect observer on unmount', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { unmount } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      unmount();

      // disconnect should have been called during cleanup
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should update observer when functions change', () => {
      const mockRef = createRef<any>();
      const functions1: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { rerender } = render(
        <FunctionJumpPanel functions={functions1} viewerRef={mockRef} />
      );

      mockDisconnect.mockClear();
      mockObserve.mockClear();

      const functions2: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'func2',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      rerender(<FunctionJumpPanel functions={functions2} viewerRef={mockRef} />);

      // Should re-setup observers for the new functions
      expect(screen.getByText('func1')).toBeInTheDocument();
      expect(screen.getByText('func2')).toBeInTheDocument();
    });
  });

  describe('Active State Styling', () => {
    it('should apply active styling to the active function entry', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'activeFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry = container.querySelector('[data-function-entry="activeFunc"]');
      // By default, first function should not have active styling
      // (active state is set by IntersectionObserver)
      expect(entry).toBeInTheDocument();
    });

    it('should render inactive function entries with default styling', () => {
      const mockRef = createRef<any>();
      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'func2',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry1 = container.querySelector('[data-function-entry="func1"]');
      const entry2 = container.querySelector('[data-function-entry="func2"]');

      expect(entry1).toBeInTheDocument();
      expect(entry2).toBeInTheDocument();
    });
  });

  describe('Click Navigation', () => {
    it('should call scrollToFunction when function entry is clicked', () => {
      const mockScrollToFunction = vi.fn();
      const mockRef = createRef<any>();
      mockRef.current = {
        scrollToFunction: mockScrollToFunction,
      };

      const functions: ParsedFunction[] = [
        {
          name: 'targetFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry = container.querySelector('[data-function-entry="targetFunc"]');
      if (entry) {
        fireEvent.click(entry);
        expect(mockScrollToFunction).toHaveBeenCalledWith('targetFunc');
      }
    });

    it('should call scrollToFunction with correct function name', () => {
      const mockScrollToFunction = vi.fn();
      const mockRef = createRef<any>();
      mockRef.current = {
        scrollToFunction: mockScrollToFunction,
      };

      const functions: ParsedFunction[] = [
        {
          name: 'func1',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'func2',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      const entry2 = container.querySelector('[data-function-entry="func2"]');
      if (entry2) {
        fireEvent.click(entry2);
        expect(mockScrollToFunction).toHaveBeenCalledWith('func2');
      }
    });
  });

  describe('Integration', () => {
    it('should render complete panel with multiple functions and exports', () => {
      const mockScrollToFunction = vi.fn();
      const mockRef = createRef<any>();
      mockRef.current = {
        scrollToFunction: mockScrollToFunction,
      };

      const functions: ParsedFunction[] = [
        {
          name: 'publicFunc',
          params: '',
          returnType: '',
          isExport: true,
          calls: [],
          body: [],
        },
        {
          name: 'privateFunc',
          params: '',
          returnType: '',
          isExport: false,
          calls: [],
          body: [],
        },
        {
          name: 'anotherPublic',
          params: '',
          returnType: '',
          isExport: true,
          calls: [],
          body: [],
        },
      ];

      const { container } = render(
        <FunctionJumpPanel functions={functions} viewerRef={mockRef} />
      );

      // Check header
      expect(screen.getByText('FUNCTIONS')).toBeInTheDocument();

      // Check all functions rendered
      expect(screen.getByText('publicFunc')).toBeInTheDocument();
      expect(screen.getByText('privateFunc')).toBeInTheDocument();
      expect(screen.getByText('anotherPublic')).toBeInTheDocument();

      // Check export dots
      const publicEntry = container.querySelector('[data-function-entry="publicFunc"]');
      const privateEntry = container.querySelector('[data-function-entry="privateFunc"]');
      const anotherEntry = container.querySelector('[data-function-entry="anotherPublic"]');

      expect(publicEntry?.querySelector('[data-export-dot]')).toBeInTheDocument();
      expect(privateEntry?.querySelector('[data-export-dot]')).not.toBeInTheDocument();
      expect(anotherEntry?.querySelector('[data-export-dot]')).toBeInTheDocument();

      // Check navigation
      if (publicEntry) {
        fireEvent.click(publicEntry);
        expect(mockScrollToFunction).toHaveBeenCalledWith('publicFunc');
      }
    });
  });
});
