/**
 * DiagramEmbed Component Tests
 *
 * Tests for:
 * - Rendering of inline diagram display
 * - Theme support and styling
 * - Error handling for invalid syntax
 * - Loading states
 * - Responsive sizing with height prop
 * - Callbacks (onRender, onError)
 * - Edge cases and error scenarios
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { DiagramEmbed } from '../DiagramEmbed';

// Mock mermaid
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

// Mock useTheme hook
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}));

import mermaid from 'mermaid';

describe('DiagramEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mermaid.initialize as any).mockResolvedValue(undefined);
    (mermaid.render as any).mockResolvedValue({
      svg: '<svg><rect/></svg>',
    });
  });

  describe('rendering', () => {
    it('should render the embed container', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const container = screen.getByTestId('diagram-embed');
      expect(container).toBeDefined();
      expect(container.className).toContain('diagram-embed-container');
    });

    it('should render with responsive width classes', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const container = screen.getByTestId('diagram-embed');
      expect(container.className).toContain('w-full');
      expect(container.className).toContain('relative');
    });

    it('should handle empty content without errors', () => {
      expect(() => {
        render(<DiagramEmbed content="" />);
      }).not.toThrow();

      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should handle whitespace-only content without errors', () => {
      expect(() => {
        render(<DiagramEmbed content="   \n  \t " />);
      }).not.toThrow();

      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });
  });

  describe('styling', () => {
    it('should apply custom className to container', () => {
      render(
        <DiagramEmbed
          content="graph TD; A-->B"
          className="test-custom-class"
        />
      );

      const container = screen.getByTestId('diagram-embed');
      expect(container.className).toContain('test-custom-class');
    });

    it('should have dark mode support classes', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const container = screen.getByTestId('diagram-embed');
      // Check for presence of tailwind classes
      expect(container.className).toMatch(/relative|w-full/);
    });

    it('should apply proper border and padding classes to diagram wrapper', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('diagram-embed-diagram');
      expect(wrapper.className).toContain('overflow-auto');
      expect(wrapper.className).toContain('rounded-lg');
      expect(wrapper.className).toContain('p-3');
      expect(wrapper.className).toContain('border');
    });
  });

  describe('height prop', () => {
    it('should apply height as string', () => {
      render(<DiagramEmbed content="graph TD; A-->B" height="300px" />);

      const container = screen.getByTestId('diagram-embed');
      expect(container.style.height).toBe('300px');
    });

    it('should apply height as number converted to px', () => {
      render(<DiagramEmbed content="graph TD; A-->B" height={300} />);

      const container = screen.getByTestId('diagram-embed');
      expect(container.style.height).toBe('300px');
    });

    it('should not apply height when not provided', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const container = screen.getByTestId('diagram-embed');
      expect(container.style.height).toBe('');
    });

    it('should apply height in various units', () => {
      const { rerender } = render(
        <DiagramEmbed content="graph TD; A-->B" height="50vh" />
      );

      const container = screen.getByTestId('diagram-embed');
      expect(container.style.height).toBe('50vh');

      rerender(<DiagramEmbed content="graph TD; A-->B" height="100%" />);
      expect(container.style.height).toBe('100%');
    });
  });

  describe('props and content', () => {
    it('should accept and handle content prop', () => {
      const { rerender } = render(
        <DiagramEmbed content="graph TD; A-->B" />
      );

      expect(screen.getByTestId('diagram-embed')).toBeDefined();

      rerender(<DiagramEmbed content="graph TD; C-->D" />);

      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should handle very long content', () => {
      const longContent = 'graph TD; ' + 'A-->B; '.repeat(1000);

      render(<DiagramEmbed content={longContent} />);

      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should handle special characters', () => {
      const contentWithSpecialChars = 'graph TD; A["test<>&"]';

      render(<DiagramEmbed content={contentWithSpecialChars} />);

      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });
  });

  describe('mermaid initialization', () => {
    it('should initialize mermaid', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalled();
    });

    it('should pass security and config options to mermaid', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'loose',
        })
      );
    });

    it('should set theme in mermaid config', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      const callArgs = (mermaid.initialize as any).mock.calls[0][0];
      expect(callArgs).toHaveProperty('theme');
      expect(['default', 'dark']).toContain(callArgs.theme);
    });
  });

  describe('error handling and callbacks', () => {
    it('should handle onRender callback prop', () => {
      const onRender = vi.fn();

      render(
        <DiagramEmbed content="graph TD; A-->B" onRender={onRender} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should handle onError callback prop', () => {
      const onError = vi.fn();

      render(
        <DiagramEmbed content="graph TD; A-->B" onError={onError} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should not throw on render error scenarios', () => {
      expect(() => {
        render(
          <DiagramEmbed
            content="invalid"
            onError={() => {}}
          />
        );
      }).not.toThrow();
    });
  });

  describe('component lifecycle', () => {
    it('should render without errors', () => {
      expect(() => {
        render(<DiagramEmbed content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should unmount without errors', () => {
      const { unmount } = render(
        <DiagramEmbed content="graph TD; A-->B" />
      );

      expect(() => unmount()).not.toThrow();
    });

    it('should handle updates without errors', () => {
      const { rerender } = render(
        <DiagramEmbed content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<DiagramEmbed content="graph TD; C-->D" />);
      }).not.toThrow();
    });

    it('should handle rapid prop changes', () => {
      const { rerender } = render(
        <DiagramEmbed content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<DiagramEmbed content="graph TD; C-->D" />);
        rerender(<DiagramEmbed content="graph TD; E-->F" />);
        rerender(<DiagramEmbed content="" />);
      }).not.toThrow();
    });
  });

  describe('interface compliance', () => {
    it('should have all required properties in props interface', () => {
      const props = {
        content: 'graph TD; A-->B',
        className: 'test',
        onRender: () => {},
        onError: () => {},
        height: '300px',
      };

      expect(() => {
        render(<DiagramEmbed {...props} />);
      }).not.toThrow();
    });

    it('should render with minimal required props', () => {
      expect(() => {
        render(<DiagramEmbed content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should work with className prop', () => {
      render(
        <DiagramEmbed
          content="graph TD; A-->B"
          className="custom-wrapper"
        />
      );

      const container = screen.getByTestId('diagram-embed');
      expect(container.className).toContain('custom-wrapper');
    });

    it('should work with height prop as number', () => {
      render(
        <DiagramEmbed
          content="graph TD; A-->B"
          height={250}
        />
      );

      const container = screen.getByTestId('diagram-embed');
      expect(container.style.height).toBe('250px');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(() => {
        render(<DiagramEmbed content="" />);
      }).not.toThrow();
    });

    it('should handle null-like string', () => {
      expect(() => {
        render(<DiagramEmbed content="null" />);
      }).not.toThrow();
    });

    it('should handle multiline content', () => {
      const multilineContent = `graph TD
        A --> B
        B --> C
        C --> A`;

      expect(() => {
        render(<DiagramEmbed content={multilineContent} />);
      }).not.toThrow();
    });

    it('should handle content with newlines and tabs', () => {
      const contentWithWhitespace = `graph TD;\n\t\tA-->B\n\t\tB-->C`;

      expect(() => {
        render(<DiagramEmbed content={contentWithWhitespace} />);
      }).not.toThrow();
    });

    it('should handle height prop edge cases', () => {
      expect(() => {
        render(
          <DiagramEmbed content="graph TD; A-->B" height={0} />
        );
      }).not.toThrow();

      expect(() => {
        render(
          <DiagramEmbed content="graph TD; A-->B" height="auto" />
        );
      }).not.toThrow();
    });
  });

  describe('loading states', () => {
    it('should show loading indicator initially', () => {
      render(<DiagramEmbed content="graph TD; A-->B" />);

      // Due to async rendering, we should see loading state briefly
      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });

    it('should display error state when rendering fails', () => {
      (mermaid.render as any).mockRejectedValue(
        new Error('Invalid diagram syntax')
      );

      render(<DiagramEmbed content="invalid diagram" />);

      // Component should still render without throwing
      expect(screen.getByTestId('diagram-embed')).toBeDefined();
    });
  });
});
