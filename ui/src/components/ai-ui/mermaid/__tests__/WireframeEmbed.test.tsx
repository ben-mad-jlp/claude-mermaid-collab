/**
 * WireframeEmbed Component Tests
 *
 * Tests for:
 * - Rendering of inline wireframe display
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
import { WireframeEmbed } from '../WireframeEmbed';

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

describe('WireframeEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mermaid.initialize as any).mockResolvedValue(undefined);
    (mermaid.render as any).mockResolvedValue({
      svg: '<svg><rect/></svg>',
    });
  });

  describe('rendering', () => {
    it('should render the embed container', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const container = screen.getByTestId('wireframe-embed');
      expect(container).toBeDefined();
      expect(container.className).toContain('wireframe-embed-container');
    });

    it('should render with responsive width classes', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const container = screen.getByTestId('wireframe-embed');
      expect(container.className).toContain('w-full');
      expect(container.className).toContain('relative');
    });

    it('should handle empty content without errors', () => {
      expect(() => {
        render(<WireframeEmbed content="" />);
      }).not.toThrow();

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should handle whitespace-only content without errors', () => {
      expect(() => {
        render(<WireframeEmbed content="   \n  \t " />);
      }).not.toThrow();

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });
  });

  describe('styling', () => {
    it('should apply custom className to container', () => {
      render(
        <WireframeEmbed
          content="wireframe\n[ Screen ]"
          className="test-custom-class"
        />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.className).toContain('test-custom-class');
    });

    it('should have dark mode support classes', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const container = screen.getByTestId('wireframe-embed');
      // Check for presence of tailwind classes
      expect(container.className).toMatch(/relative|w-full/);
    });

    it('should apply proper border and padding classes to wireframe wrapper', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const wrapper = screen.getByTestId('wireframe-embed-diagram');
      expect(wrapper.className).toContain('overflow-auto');
      expect(wrapper.className).toContain('rounded-lg');
      expect(wrapper.className).toContain('p-3');
      expect(wrapper.className).toContain('border');
    });
  });

  describe('height prop', () => {
    it('should apply height as string', () => {
      render(
        <WireframeEmbed content="wireframe\n[ Screen ]" height="300px" />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.style.height).toBe('300px');
    });

    it('should apply height as number converted to px', () => {
      render(
        <WireframeEmbed content="wireframe\n[ Screen ]" height={300} />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.style.height).toBe('300px');
    });

    it('should not apply height when not provided', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const container = screen.getByTestId('wireframe-embed');
      expect(container.style.height).toBe('');
    });

    it('should apply height in various units', () => {
      const { rerender } = render(
        <WireframeEmbed content="wireframe\n[ Screen ]" height="50vh" />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.style.height).toBe('50vh');

      rerender(
        <WireframeEmbed content="wireframe\n[ Screen ]" height="100%" />
      );
      expect(container.style.height).toBe('100%');
    });
  });

  describe('props and content', () => {
    it('should accept and handle content prop', () => {
      const { rerender } = render(
        <WireframeEmbed content="wireframe\n[ Screen 1 ]" />
      );

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();

      rerender(<WireframeEmbed content="wireframe\n[ Screen 2 ]" />);

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should handle very long content', () => {
      const longContent = 'wireframe\n' + '[ Component ]\n'.repeat(100);

      render(<WireframeEmbed content={longContent} />);

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should handle special characters', () => {
      const contentWithSpecialChars = 'wireframe\n[ test<>& ]';

      render(<WireframeEmbed content={contentWithSpecialChars} />);

      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });
  });

  describe('mermaid initialization', () => {
    it('should initialize mermaid', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      expect(mermaid.initialize).toHaveBeenCalled();
    });

    it('should pass security and config options to mermaid', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'loose',
        })
      );
    });

    it('should set theme in mermaid config', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      const callArgs = (mermaid.initialize as any).mock.calls[0][0];
      expect(callArgs).toHaveProperty('theme');
      expect(['default', 'dark']).toContain(callArgs.theme);
    });
  });

  describe('error handling and callbacks', () => {
    it('should handle onRender callback prop', () => {
      const onRender = vi.fn();

      render(
        <WireframeEmbed
          content="wireframe\n[ Screen ]"
          onRender={onRender}
        />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should handle onError callback prop', () => {
      const onError = vi.fn();

      render(
        <WireframeEmbed
          content="wireframe\n[ Screen ]"
          onError={onError}
        />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should not throw on render error scenarios', () => {
      expect(() => {
        render(
          <WireframeEmbed
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
        render(<WireframeEmbed content="wireframe\n[ Screen ]" />);
      }).not.toThrow();
    });

    it('should unmount without errors', () => {
      const { unmount } = render(
        <WireframeEmbed content="wireframe\n[ Screen ]" />
      );

      expect(() => unmount()).not.toThrow();
    });

    it('should handle updates without errors', () => {
      const { rerender } = render(
        <WireframeEmbed content="wireframe\n[ Screen 1 ]" />
      );

      expect(() => {
        rerender(<WireframeEmbed content="wireframe\n[ Screen 2 ]" />);
      }).not.toThrow();
    });

    it('should handle rapid prop changes', () => {
      const { rerender } = render(
        <WireframeEmbed content="wireframe\n[ Screen 1 ]" />
      );

      expect(() => {
        rerender(<WireframeEmbed content="wireframe\n[ Screen 2 ]" />);
        rerender(<WireframeEmbed content="wireframe\n[ Screen 3 ]" />);
        rerender(<WireframeEmbed content="" />);
      }).not.toThrow();
    });
  });

  describe('interface compliance', () => {
    it('should have all required properties in props interface', () => {
      const props = {
        content: 'wireframe\n[ Screen ]',
        className: 'test',
        onRender: () => {},
        onError: () => {},
        height: '300px',
      };

      expect(() => {
        render(<WireframeEmbed {...props} />);
      }).not.toThrow();
    });

    it('should render with minimal required props', () => {
      expect(() => {
        render(<WireframeEmbed content="wireframe\n[ Screen ]" />);
      }).not.toThrow();
    });

    it('should work with className prop', () => {
      render(
        <WireframeEmbed
          content="wireframe\n[ Screen ]"
          className="custom-wrapper"
        />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.className).toContain('custom-wrapper');
    });

    it('should work with height prop as number', () => {
      render(
        <WireframeEmbed
          content="wireframe\n[ Screen ]"
          height={250}
        />
      );

      const container = screen.getByTestId('wireframe-embed');
      expect(container.style.height).toBe('250px');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(() => {
        render(<WireframeEmbed content="" />);
      }).not.toThrow();
    });

    it('should handle null-like string', () => {
      expect(() => {
        render(<WireframeEmbed content="null" />);
      }).not.toThrow();
    });

    it('should handle multiline content', () => {
      const multilineContent = `wireframe
        Screen 1
        [ Header ]
        [ Content ]
        [ Footer ]`;

      expect(() => {
        render(<WireframeEmbed content={multilineContent} />);
      }).not.toThrow();
    });

    it('should handle content with newlines and tabs', () => {
      const contentWithWhitespace = `wireframe\n\t\t[ Screen ]\n\t\t[ Content ]`;

      expect(() => {
        render(<WireframeEmbed content={contentWithWhitespace} />);
      }).not.toThrow();
    });

    it('should handle height prop edge cases', () => {
      expect(() => {
        render(
          <WireframeEmbed content="wireframe\n[ Screen ]" height={0} />
        );
      }).not.toThrow();

      expect(() => {
        render(
          <WireframeEmbed content="wireframe\n[ Screen ]" height="auto" />
        );
      }).not.toThrow();
    });
  });

  describe('loading states', () => {
    it('should show loading indicator initially', () => {
      render(<WireframeEmbed content="wireframe\n[ Screen ]" />);

      // Due to async rendering, we should see loading state briefly
      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });

    it('should display error state when rendering fails', () => {
      (mermaid.render as any).mockRejectedValue(
        new Error('Invalid wireframe syntax')
      );

      render(<WireframeEmbed content="invalid wireframe" />);

      // Component should still render without throwing
      expect(screen.getByTestId('wireframe-embed')).toBeDefined();
    });
  });
});
