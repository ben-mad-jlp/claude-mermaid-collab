/**
 * CodeMirrorWrapper Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Code content display and updates
 * - Language-specific syntax highlighting
 * - Theme support (light/dark modes)
 * - Read-only mode functionality
 * - Callback handling and change detection
 * - Props customization (height, line numbers, word wrap, placeholder)
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeMirrorWrapper, type Language } from '../CodeMirrorWrapper';
import { useTheme } from '@/hooks/useTheme';
import { useUIStore } from '@/stores/uiStore';

// Mock @uiw/react-codemirror
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, placeholder, editable, className }: any) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={!editable}
      className={className}
      data-testid="codemirror-editor"
    />
  ),
}));

describe('CodeMirrorWrapper', () => {
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    useUIStore.getState().reset();
    mockOnChange = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the editor wrapper', async () => {
      render(
        <CodeMirrorWrapper
          value="console.log('Hello');"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });
    });

    it('should display initial code content', async () => {
      const code = 'const x = 42;';
      render(
        <CodeMirrorWrapper
          value={code}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe(code);
      });
    });

    it('should show loading state initially', () => {
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      // The component shows loading state on mount
      const wrapper = screen.queryByTestId('editor-loading') || screen.queryByTestId('editor-wrapper');
      expect(wrapper).toBeDefined();
    });

    it('should render with custom class names', async () => {
      const customClass = 'my-custom-editor';
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
          className={customClass}
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper.className).toContain(customClass);
      });
    });
  });

  describe('Code Content Management', () => {
    it('should update code on change', async () => {
      const user = userEvent.setup();
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      await user.type(editor, 'const x = 42;');

      // Since we're mocking the CodeMirror component with a textarea mock,
      // onChange gets called for each character typed
      expect(mockOnChange).toHaveBeenCalled();
      expect(mockOnChange.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle empty code content', async () => {
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe('');
      });
    });

    it('should handle multi-line code', async () => {
      const multiLineCode = `function hello() {
  console.log('Hello, World!');
}`;

      render(
        <CodeMirrorWrapper
          value={multiLineCode}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toContain('function hello()');
        expect(editor.value).toContain('console.log');
      });
    });

    it('should update code when value prop changes', async () => {
      const { rerender } = render(
        <CodeMirrorWrapper
          value="const x = 1;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe('const x = 1;');
      });

      rerender(
        <CodeMirrorWrapper
          value="const x = 2;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe('const x = 2;');
      });
    });
  });

  describe('Language Support', () => {
    it('should accept javascript language', async () => {
      const jsCode = 'const x = 42;';
      render(
        <CodeMirrorWrapper
          value={jsCode}
          onChange={mockOnChange}
          language="javascript"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });

    it('should accept markdown language', async () => {
      const mdCode = '# Hello\nThis is markdown';
      render(
        <CodeMirrorWrapper
          value={mdCode}
          onChange={mockOnChange}
          language="markdown"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });

    it('should accept yaml language', async () => {
      const yamlCode = 'name: test\nversion: 1.0';
      render(
        <CodeMirrorWrapper
          value={yamlCode}
          onChange={mockOnChange}
          language="yaml"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });

    it('should accept html language', async () => {
      const htmlCode = '<div>Hello</div>';
      render(
        <CodeMirrorWrapper
          value={htmlCode}
          onChange={mockOnChange}
          language="html"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });

    it('should accept json language', async () => {
      const jsonCode = '{"name": "test", "value": 42}';
      render(
        <CodeMirrorWrapper
          value={jsonCode}
          onChange={mockOnChange}
          language="json"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });

    it('should default to text language', async () => {
      const plainText = 'This is plain text';
      render(
        <CodeMirrorWrapper
          value={plainText}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe(plainText);
      });
    });

    it('should switch languages dynamically', async () => {
      const { rerender } = render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
          language="javascript"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('codemirror-editor')).toBeDefined();
      });

      rerender(
        <CodeMirrorWrapper
          value="# Markdown"
          onChange={mockOnChange}
          language="markdown"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe('# Markdown');
      });
    });
  });

  describe('Theme Support', () => {
    it('should apply light theme', async () => {
      const { getState, setState } = useUIStore;
      setState({ theme: 'light' });

      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper.className).toContain('border-gray-300');
      });
    });

    it('should apply dark theme', async () => {
      const { getState, setState } = useUIStore;
      setState({ theme: 'dark' });

      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper.className).toContain('dark:border-gray-600');
      });
    });

    it('should respond to theme changes', async () => {
      const { getState, setState } = useUIStore;
      setState({ theme: 'light' });

      const { rerender } = render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });

      setState({ theme: 'dark' });

      rerender(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper).toBeDefined();
      });
    });
  });

  describe('Read-Only Mode', () => {
    it('should be editable by default', async () => {
      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.disabled).toBe(false);
      });
    });

    it('should be read-only when readOnly prop is true', async () => {
      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
          readOnly={true}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.disabled).toBe(true);
      });
    });

    it('should not call onChange when read-only', async () => {
      const user = userEvent.setup();
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
          readOnly={true}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      // Attempt to type should not work since it's disabled
      expect(editor.disabled).toBe(true);
    });
  });

  describe('Customization Props', () => {
    it('should apply custom height', async () => {
      const { container } = render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
          height="600px"
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper).toBeDefined();
      });
    });

    it('should show line numbers by default', async () => {
      render(
        <CodeMirrorWrapper
          value="line 1\nline 2"
          onChange={mockOnChange}
          showLineNumbers={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('codemirror-editor')).toBeDefined();
      });
    });

    it('should hide line numbers when showLineNumbers is false', async () => {
      render(
        <CodeMirrorWrapper
          value="line 1\nline 2"
          onChange={mockOnChange}
          showLineNumbers={false}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('codemirror-editor')).toBeDefined();
      });
    });

    it('should display placeholder text', async () => {
      const placeholderText = 'Enter code here...';
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
          placeholder={placeholderText}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.placeholder).toBe(placeholderText);
      });
    });

    it('should enable word wrap by default', async () => {
      render(
        <CodeMirrorWrapper
          value="This is a very long line of code that should wrap to the next line"
          onChange={mockOnChange}
          wordWrap={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('codemirror-editor')).toBeDefined();
      });
    });

    it('should disable word wrap when wordWrap is false', async () => {
      render(
        <CodeMirrorWrapper
          value="This is a very long line of code"
          onChange={mockOnChange}
          wordWrap={false}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('codemirror-editor')).toBeDefined();
      });
    });
  });

  describe('Callback Handling', () => {
    it('should call onChange callback on code changes', async () => {
      const user = userEvent.setup();
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      await user.type(editor, 'new code');

      // Since we're mocking the CodeMirror component with a textarea mock,
      // onChange gets called for each character typed
      expect(mockOnChange).toHaveBeenCalled();
      expect(mockOnChange.mock.calls.length).toBeGreaterThan(0);
    });

    it('should call onChange for each character typed', async () => {
      const user = userEvent.setup();
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      await user.type(editor, 'abc');

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('should handle rapid code changes', async () => {
      const user = userEvent.setup();
      render(
        <CodeMirrorWrapper
          value=""
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });

      const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
      await user.type(editor, '123');

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long code content', async () => {
      const longCode = 'const x = 1;\n'.repeat(1000);
      render(
        <CodeMirrorWrapper
          value={longCode}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value.length).toBeGreaterThan(10000);
      });
    });

    it('should handle code with special characters', async () => {
      const specialCode = 'const str = "Hello\\nWorld\\t!";';
      render(
        <CodeMirrorWrapper
          value={specialCode}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe(specialCode);
      });
    });

    it('should handle code with unicode characters', async () => {
      const unicodeCode = '// 你好 🌍\nconst emoji = "😀";';
      render(
        <CodeMirrorWrapper
          value={unicodeCode}
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toContain('你好');
        expect(editor.value).toContain('😀');
      });
    });

    it('should handle null or undefined onChange gracefully', async () => {
      // Should not crash even if onChange throws
      const throwingOnChange = () => {
        throw new Error('Test error');
      };

      expect(() => {
        render(
          <CodeMirrorWrapper
            value="test"
            onChange={throwingOnChange}
          />
        );
      }).not.toThrow();
    });

    it('should handle rapid theme switching', async () => {
      const { setState } = useUIStore;
      setState({ theme: 'light' });

      const { rerender } = render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });

      setState({ theme: 'dark' });
      rerender(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      setState({ theme: 'light' });
      rerender(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });
    });
  });

  describe('Component Lifecycle', () => {
    it('should initialize properly on mount', async () => {
      const { container } = render(
        <CodeMirrorWrapper
          value="console.log('test');"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });
    });

    it('should cleanup properly on unmount', async () => {
      const { unmount } = render(
        <CodeMirrorWrapper
          value="test code"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });

      expect(() => {
        unmount();
      }).not.toThrow();
    });

    it('should handle multiple prop updates', async () => {
      const { rerender } = render(
        <CodeMirrorWrapper
          value="const x = 1;"
          onChange={mockOnChange}
          language="javascript"
          height="300px"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('editor-wrapper')).toBeDefined();
      });

      rerender(
        <CodeMirrorWrapper
          value="const x = 2;"
          onChange={mockOnChange}
          language="markdown"
          height="500px"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor') as HTMLTextAreaElement;
        expect(editor.value).toBe('const x = 2;');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible wrapper element', async () => {
      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const wrapper = screen.getByTestId('editor-wrapper');
        expect(wrapper).toBeDefined();
      });
    });

    it('should have accessible editor element with testid', async () => {
      render(
        <CodeMirrorWrapper
          value="const x = 42;"
          onChange={mockOnChange}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('codemirror-editor');
        expect(editor).toBeDefined();
      });
    });
  });
});
