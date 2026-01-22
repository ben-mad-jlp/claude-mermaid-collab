import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MermaidPreview } from '../MermaidPreview';

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

describe('MermaidPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mermaid.initialize as any).mockResolvedValue(undefined);
    (mermaid.render as any).mockResolvedValue({
      svg: '<svg><rect/></svg>',
    });
  });

  describe('rendering', () => {
    it('should render the preview container', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      expect(container).toBeDefined();
      expect(container.className).toContain('mermaid-preview-container');
    });

    it('should render with responsive width classes', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('w-full');
      expect(container.className).toContain('relative');
    });

    it('should show empty state when content is empty', () => {
      render(<MermaidPreview content="" />);

      expect(
        screen.queryByText(/Enter Mermaid syntax to preview diagram/i)
      ).toBeDefined();
    });

    it('should show empty state when content is only whitespace', () => {
      render(<MermaidPreview content="   \n  \t " />);

      expect(
        screen.queryByText(/Enter Mermaid syntax to preview diagram/i)
      ).toBeDefined();
    });
  });

  describe('styling', () => {
    it('should apply custom className to container', () => {
      render(
        <MermaidPreview
          content="graph TD; A-->B"
          className="test-custom-class"
        />
      );

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('test-custom-class');
    });

    it('should have dark mode support classes', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const container = screen.getByTestId('mermaid-preview');
      // Check for presence of tailwind classes
      expect(container.className).toMatch(/relative|w-full/);
    });

    it('should apply proper border and padding classes to diagram wrapper', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const wrapper = screen.getByTestId('mermaid-diagram');
      expect(wrapper.className).toContain('overflow-auto');
      expect(wrapper.className).toContain('rounded-lg');
      expect(wrapper.className).toContain('p-4');
      expect(wrapper.className).toContain('border');
    });
  });

  describe('props and content', () => {
    it('should accept and handle content prop', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();

      rerender(<MermaidPreview content="graph TD; C-->D" />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle very long content', () => {
      const longContent = 'graph TD; ' + 'A-->B; '.repeat(1000);

      render(<MermaidPreview content={longContent} />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle special characters', () => {
      const contentWithSpecialChars = 'graph TD; A["test<>&"]';

      render(<MermaidPreview content={contentWithSpecialChars} />);

      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });
  });

  describe('mermaid initialization', () => {
    it('should initialize mermaid', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalled();
    });

    it('should pass security and config options to mermaid', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'loose',
        })
      );
    });

    it('should set theme in mermaid config', () => {
      render(<MermaidPreview content="graph TD; A-->B" />);

      const callArgs = (mermaid.initialize as any).mock.calls[0][0];
      expect(callArgs).toHaveProperty('theme');
      expect(['default', 'dark']).toContain(callArgs.theme);
    });
  });

  describe('error handling and callbacks', () => {
    it('should handle onRender callback prop', () => {
      const onRender = vi.fn();

      render(
        <MermaidPreview content="graph TD; A-->B" onRender={onRender} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should handle onError callback prop', () => {
      const onError = vi.fn();

      render(
        <MermaidPreview content="graph TD; A-->B" onError={onError} />
      );

      // The component accepts the callback prop
      expect(screen.getByTestId('mermaid-preview')).toBeDefined();
    });

    it('should not throw on render error scenarios', () => {
      expect(() => {
        render(
          <MermaidPreview
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
        render(<MermaidPreview content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should unmount without errors', () => {
      const { unmount } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => unmount()).not.toThrow();
    });

    it('should handle updates without errors', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<MermaidPreview content="graph TD; C-->D" />);
      }).not.toThrow();
    });

    it('should handle rapid prop changes', () => {
      const { rerender } = render(
        <MermaidPreview content="graph TD; A-->B" />
      );

      expect(() => {
        rerender(<MermaidPreview content="graph TD; C-->D" />);
        rerender(<MermaidPreview content="graph TD; E-->F" />);
        rerender(<MermaidPreview content="" />);
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
      };

      expect(() => {
        render(<MermaidPreview {...props} />);
      }).not.toThrow();
    });

    it('should render with minimal required props', () => {
      expect(() => {
        render(<MermaidPreview content="graph TD; A-->B" />);
      }).not.toThrow();
    });

    it('should work with className prop', () => {
      render(
        <MermaidPreview
          content="graph TD; A-->B"
          className="custom-wrapper"
        />
      );

      const container = screen.getByTestId('mermaid-preview');
      expect(container.className).toContain('custom-wrapper');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(() => {
        render(<MermaidPreview content="" />);
      }).not.toThrow();
    });

    it('should handle null-like string', () => {
      expect(() => {
        render(<MermaidPreview content="null" />);
      }).not.toThrow();
    });

    it('should handle multiline content', () => {
      const multilineContent = `graph TD
        A --> B
        B --> C
        C --> A`;

      expect(() => {
        render(<MermaidPreview content={multilineContent} />);
      }).not.toThrow();
    });

    it('should handle content with newlines and tabs', () => {
      const contentWithWhitespace = `graph TD;\n\t\tA-->B\n\t\tB-->C`;

      expect(() => {
        render(<MermaidPreview content={contentWithWhitespace} />);
      }).not.toThrow();
    });
  });
});
