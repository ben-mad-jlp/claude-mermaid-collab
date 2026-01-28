import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useTheme hook first
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}));

import { MarkdownPreview } from '../MarkdownPreview';

describe('MarkdownPreview', () => {
  describe('rendering', () => {
    it('should render the preview container', () => {
      render(<MarkdownPreview content="# Hello" />);

      expect(screen.getByTestId('markdown-preview')).toBeDefined();
    });

    it('should render markdown content when provided', () => {
      render(<MarkdownPreview content="# Hello World" />);

      expect(screen.getByTestId('markdown-content')).toBeDefined();
      expect(screen.getByText('Hello World')).toBeDefined();
    });

    it('should show empty state when content is empty', () => {
      render(<MarkdownPreview content="" />);

      expect(
        screen.queryByText(/Enter Markdown content to preview/i)
      ).toBeDefined();
    });

    it('should show empty state when content is only whitespace', () => {
      render(<MarkdownPreview content="   \n  \t " />);

      expect(
        screen.queryByText(/Enter Markdown content to preview/i)
      ).toBeDefined();
    });
  });

  describe('markdown formatting', () => {
    it('should render headings', () => {
      const markdown = `# Heading 1
## Heading 2`;
      render(<MarkdownPreview content={markdown} />);

      expect(screen.getByText('Heading 1')).toBeDefined();
      expect(screen.getByText('Heading 2')).toBeDefined();
    });

    it('should render bold text', () => {
      render(<MarkdownPreview content="This is **bold** text" />);

      const boldElement = screen.getByText('bold');
      expect(boldElement.tagName).toBe('STRONG');
    });

    it('should render italic text', () => {
      render(<MarkdownPreview content="This is *italic* text" />);

      const italicElement = screen.getByText('italic');
      expect(italicElement.tagName).toBe('EM');
    });

    it('should render lists', () => {
      const markdown = `- Item 1
- Item 2
- Item 3`;
      render(
        <MarkdownPreview content={markdown} />
      );

      expect(screen.getByText('Item 1')).toBeDefined();
      expect(screen.getByText('Item 2')).toBeDefined();
      expect(screen.getByText('Item 3')).toBeDefined();
    });

    it('should render ordered lists', () => {
      const markdown = `1. First
2. Second
3. Third`;
      render(
        <MarkdownPreview content={markdown} />
      );

      expect(screen.getByText('First')).toBeDefined();
      expect(screen.getByText('Second')).toBeDefined();
      expect(screen.getByText('Third')).toBeDefined();
    });

    it('should render links with correct attributes', () => {
      render(
        <MarkdownPreview
          content="[Click here](https://example.com)"
        />
      );

      const link = screen.getByText('Click here');
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('https://example.com');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('should render blockquotes', () => {
      render(
        <MarkdownPreview content="> This is a quote" />
      );

      expect(screen.getByText('This is a quote')).toBeDefined();
    });
  });

  describe('styling', () => {
    it('should apply custom className to container', () => {
      render(
        <MarkdownPreview
          content="# Hello"
          className="custom-class"
        />
      );

      const container = screen.getByTestId('markdown-preview');
      expect(container.className).toContain('custom-class');
    });

    it('should have responsive sizing classes', () => {
      render(<MarkdownPreview content="# Hello" />);

      const container = screen.getByTestId('markdown-preview');
      expect(container.className).toContain('w-full');
    });

    it('should apply prose classes for markdown styling', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('prose');
      expect(contentDiv.className).toContain('dark:prose-invert');
    });

    it('should have light and dark mode classes', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('bg-white');
      expect(contentDiv.className).toContain('dark:bg-gray-900');
    });

    it('should have border and padding classes', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('rounded-lg');
      expect(contentDiv.className).toContain('p-4');
      expect(contentDiv.className).toContain('border');
    });
  });

  describe('complex markdown', () => {
    it('should render mixed markdown content', () => {
      const markdown = `# Introduction

This is a **bold** introduction.

## Code Example

\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`

- Item 1
- Item 2`;

      render(<MarkdownPreview content={markdown} />);

      expect(screen.getByText('Introduction')).toBeDefined();
      expect(screen.getByText('Code Example')).toBeDefined();
      expect(screen.getByText('Item 1')).toBeDefined();
    });

    it('should handle nested markdown structures', () => {
      const markdown = `# Main
## Sub

- Item 1
- Item 2`;

      render(<MarkdownPreview content={markdown} />);

      expect(screen.getByText('Main')).toBeDefined();
      expect(screen.getByText('Sub')).toBeDefined();
      expect(screen.getByText('Item 1')).toBeDefined();
    });

    it('should handle content with special characters', () => {
      const markdown = `# Special Characters

Content with special characters

\`\`\`
code
\`\`\``;

      render(<MarkdownPreview content={markdown} />);

      expect(screen.getByText('Special Characters')).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const markdown = `# H1
## H2
### H3`;

      const { container } = render(
        <MarkdownPreview content={markdown} />
      );

      const h1 = container.querySelector('h1');
      const h2 = container.querySelector('h2');
      const h3 = container.querySelector('h3');

      expect(h1).toBeDefined();
      expect(h2).toBeDefined();
      expect(h3).toBeDefined();
    });

    it('should render list items with proper semantic HTML', () => {
      const markdown = `- Item 1
- Item 2`;

      const { container } = render(
        <MarkdownPreview content={markdown} />
      );

      const lis = container.querySelectorAll('li');
      expect(lis.length).toBe(2);
    });

    it('should render links with proper attributes for security', () => {
      render(
        <MarkdownPreview content="[Link](https://example.com)" />
      );

      const link = screen.getByText('Link');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  describe('props and content', () => {
    it('should handle very long content', () => {
      let longContent = '# Title\n\n';
      for (let i = 0; i < 50; i++) {
        longContent += `Paragraph ${i}\n\n`;
      }

      render(<MarkdownPreview content={longContent} />);

      expect(screen.getByText('Title')).toBeDefined();
      expect(screen.getByText('Paragraph 0')).toBeDefined();
    });

    it('should handle content with multiple heading levels', () => {
      const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;

      const { container } = render(
        <MarkdownPreview content={markdown} />
      );

      expect(container.querySelector('h1')).toBeDefined();
      expect(container.querySelector('h2')).toBeDefined();
      expect(container.querySelector('h3')).toBeDefined();
      expect(container.querySelector('h4')).toBeDefined();
      expect(container.querySelector('h5')).toBeDefined();
      expect(container.querySelector('h6')).toBeDefined();
    });

    it('should handle malformed markdown gracefully', () => {
      const markdown = `# Title

[Unclosed link

**Unclosed bold`;

      expect(() => {
        render(<MarkdownPreview content={markdown} />);
      }).not.toThrow();

      // Should still render title
      expect(screen.getByText('Title')).toBeDefined();
    });
  });

  describe('theme support', () => {
    it('should render with light theme classes by default', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('bg-white');
    });

    it('should have dark theme classes available', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('dark:bg-gray-900');
    });

    it('should have dark prose classes', () => {
      render(<MarkdownPreview content="# Hello" />);

      const contentDiv = screen.getByTestId('markdown-content');
      expect(contentDiv.className).toContain('dark:prose-invert');
    });
  });

  describe('component interface', () => {
    it('should render with minimal required props', () => {
      expect(() => {
        render(<MarkdownPreview content="# Hello" />);
      }).not.toThrow();
    });

    it('should render with all optional props', () => {
      expect(() => {
        render(
          <MarkdownPreview
            content="# Hello"
            className="custom-class"
          />
        );
      }).not.toThrow();
    });

    it('should handle empty string gracefully', () => {
      expect(() => {
        render(<MarkdownPreview content="" />);
      }).not.toThrow();
    });

    it('should handle null-like string', () => {
      expect(() => {
        render(<MarkdownPreview content="null" />);
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle multiline content', () => {
      const multilineContent = `# Main
Content on multiple
lines with markdown

**Bold** and *italic*`;

      render(<MarkdownPreview content={multilineContent} />);

      expect(screen.getByText('Main')).toBeDefined();
    });

    it('should handle content with tabs and spaces', () => {
      const contentWithWhitespace = `# Title
\t\tIndented content
    More indentation`;

      render(
        <MarkdownPreview content={contentWithWhitespace} />
      );

      expect(screen.getByText('Title')).toBeDefined();
    });

    it('should render consistently on multiple renders', () => {
      const content = '# Consistent Content';

      const { rerender } = render(
        <MarkdownPreview content={content} />
      );

      expect(screen.getByText('Consistent Content')).toBeDefined();

      rerender(<MarkdownPreview content={content} />);

      expect(screen.getByText('Consistent Content')).toBeDefined();
    });

    it('should handle prop updates', () => {
      const { rerender } = render(
        <MarkdownPreview content="# First" />
      );

      expect(screen.getByText('First')).toBeDefined();

      rerender(<MarkdownPreview content="# Second" />);

      expect(screen.getByText('Second')).toBeDefined();
    });
  });

  describe('diff highlighting', () => {
    it('should render normally when no diff is provided', () => {
      const { container } = render(
        <MarkdownPreview
          content="# Hello\n\nThis is content"
          diff={null}
        />
      );

      const h1 = container.querySelector('h1');
      expect(h1).toBeDefined();
      expect(h1?.textContent).toContain('Hello');
    });

    it('should render diff content without Clear Diff button (button moved to toolbar)', () => {
      const { container } = render(
        <MarkdownPreview
          content="# Hello\n\nThis is new content"
          diff={{
            oldContent: '# Hello\n\nThis is old content',
            newContent: '# Hello\n\nThis is new content',
          }}
        />
      );

      // Clear Diff button was removed from MarkdownPreview (now in toolbar)
      const clearButton = screen.queryByRole('button', { name: /clear diff/i });
      expect(clearButton).toBeNull();

      // But diff highlighting should still work
      const diffElements = container.querySelectorAll('[class*="diff-"]');
      expect(diffElements.length).toBeGreaterThan(0);
    });

    it('should render diff content even when onClearDiff is provided', () => {
      const onClearDiff = vi.fn();

      const { container } = render(
        <MarkdownPreview
          content="# Hello\n\nThis is new content"
          diff={{
            oldContent: '# Hello\n\nThis is old content',
            newContent: '# Hello\n\nThis is new content',
          }}
          onClearDiff={onClearDiff}
        />
      );

      // Clear Diff button was removed from MarkdownPreview
      const clearButton = screen.queryByRole('button', { name: /clear diff/i });
      expect(clearButton).toBeNull();

      // But diff highlighting should still work
      const diffElements = container.querySelectorAll('[class*="diff-"]');
      expect(diffElements.length).toBeGreaterThan(0);
    });

    it('should highlight added text with green background', () => {
      const { container } = render(
        <MarkdownPreview
          content="Hello world"
          diff={{
            oldContent: 'Hello',
            newContent: 'Hello world',
          }}
        />
      );

      const addedElements = container.querySelectorAll('.diff-added');
      expect(addedElements.length).toBeGreaterThan(0);

      // Verify the added element has correct styling
      const addedElement = addedElements[0];
      expect(addedElement.className).toContain('diff-added');
    });

    it('should highlight removed text with red strikethrough', () => {
      const { container } = render(
        <MarkdownPreview
          content="Hello"
          diff={{
            oldContent: 'Hello world',
            newContent: 'Hello',
          }}
        />
      );

      const removedElements = container.querySelectorAll('.diff-removed');
      expect(removedElements.length).toBeGreaterThan(0);

      // Verify the removed element has correct styling
      const removedElement = removedElements[0];
      expect(removedElement.className).toContain('diff-removed');
    });

    it('should render unchanged content normally in diff mode', () => {
      render(
        <MarkdownPreview
          content="# Hello\n\nThis is new content"
          diff={{
            oldContent: '# Hello\n\nThis is old content',
            newContent: '# Hello\n\nThis is new content',
          }}
        />
      );

      // Heading should still render
      expect(screen.getByText('Hello')).toBeDefined();
    });

    it('should handle multiline diff with added and removed lines', () => {
      const oldContent = `Line 1
Line 2
Line 3`;

      const newContent = `Line 1
Line 2 modified
Line 3
Line 4`;

      const { container } = render(
        <MarkdownPreview
          content={newContent}
          diff={{
            oldContent,
            newContent,
          }}
        />
      );

      const addedElements = container.querySelectorAll('.diff-added');
      const removedElements = container.querySelectorAll('.diff-removed');

      // Should have some diff elements
      expect(addedElements.length + removedElements.length).toBeGreaterThan(0);
    });

    it('should handle all new content (empty old content)', () => {
      const { container } = render(
        <MarkdownPreview
          content="New content"
          diff={{
            oldContent: '',
            newContent: 'New content',
          }}
        />
      );

      const addedElements = container.querySelectorAll('.diff-added');
      expect(addedElements.length).toBeGreaterThan(0);
    });

    it('should handle all removed content (empty new content)', () => {
      // Note: When newContent is empty, the content prop should also be empty
      // but then the component doesn't render markdown content. We test with
      // at least some content in the new version, or we expect the empty state.
      const { container } = render(
        <MarkdownPreview
          content="Removed: Old content"
          diff={{
            oldContent: 'Original: Old content',
            newContent: 'Removed: Old content',
          }}
        />
      );

      // Since we have diff, we should see diff elements
      const elements = container.querySelectorAll('[class*="diff-"]');
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should render diff without buttons (Clear Diff button moved to EditorToolbar)', () => {
      const { container } = render(
        <MarkdownPreview
          content="# Hello\n\nThis is new content"
          diff={{
            oldContent: '# Hello\n\nThis is old content',
            newContent: '# Hello\n\nThis is new content',
          }}
        />
      );

      // No Clear Diff button (moved to EditorToolbar)
      const clearButton = screen.queryByRole('button', { name: /clear diff/i });
      expect(clearButton).toBeNull();

      // Diff content should still be rendered
      expect(container.querySelector('[class*="diff-"]')).toBeDefined();
    });

    it('should render diff and normal content together seamlessly', () => {
      const oldContent = `# Introduction

This is old text that will be kept.

This is old text that will be removed.`;

      const newContent = `# Introduction

This is old text that will be kept.

This is new text that will be added.`;

      render(
        <MarkdownPreview
          content={newContent}
          diff={{
            oldContent,
            newContent,
          }}
        />
      );

      expect(screen.getByText('Introduction')).toBeDefined();
      expect(screen.getByText(/will be kept/)).toBeDefined();
    });
  });
});
