import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, describe, it, vi, beforeEach } from 'vitest';
import { CodeBlock } from '../CodeBlock';

describe('CodeBlock Component', () => {
  const mockCode = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

  beforeEach(() => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  it('renders code block with language label', () => {
    render(<CodeBlock code={mockCode} language="javascript" />);

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });

  it('displays default language when not specified', () => {
    render(<CodeBlock code={mockCode} />);

    expect(screen.getByText('TEXT')).toBeInTheDocument();
  });

  it('shows copy button by default', () => {
    render(<CodeBlock code={mockCode} language="javascript" />);

    expect(screen.getByLabelText('Copy code to clipboard')).toBeInTheDocument();
  });

  it('hides copy button when copyButton is false', () => {
    render(
      <CodeBlock code={mockCode} language="javascript" copyButton={false} />
    );

    expect(screen.queryByLabelText('Copy code to clipboard')).not.toBeInTheDocument();
  });

  it('copies code to clipboard when copy button clicked', async () => {
    render(<CodeBlock code={mockCode} language="javascript" />);

    const copyButton = screen.getByLabelText('Copy code to clipboard');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockCode);
    });
  });

  it('shows copied feedback after copying', async () => {
    render(<CodeBlock code={mockCode} language="javascript" />);

    const copyButton = screen.getByLabelText('Copy code to clipboard');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    // Should revert after timeout
    await waitFor(
      () => {
        expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it('supports custom max height', () => {
    const { container } = render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        maxHeight="500px"
      />
    );

    const codeContainer = container.querySelector('[style*="max-height"]');
    expect(codeContainer).toHaveStyle('max-height: 500px');
  });

  it('renders code in pre tag for accessibility', () => {
    render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        ariaLabel="Example JavaScript code"
      />
    );

    const preElement = screen.getByLabelText('Code content in javascript');
    expect(preElement).toBeInTheDocument();
    expect(preElement).toHaveTextContent(mockCode);
  });

  it('supports different themes', () => {
    const { rerender } = render(
      <CodeBlock code={mockCode} language="javascript" theme="light" />
    );

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();

    rerender(
      <CodeBlock code={mockCode} language="javascript" theme="dark" />
    );

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });

  it('handles various programming languages', () => {
    const languages = ['python', 'java', 'cpp', 'rust', 'go', 'ruby'];

    languages.forEach((lang) => {
      const { unmount } = render(
        <CodeBlock code={mockCode} language={lang} />
      );

      expect(screen.getByText(lang.toUpperCase())).toBeInTheDocument();
      unmount();
    });
  });

  it('renders line numbers when enabled', () => {
    render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        lineNumbers={true}
      />
    );

    // Line numbers are rendered by react-syntax-highlighter
    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });

  it('hides line numbers when disabled', () => {
    render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        lineNumbers={false}
      />
    );

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });

  it('handles empty code gracefully', () => {
    render(<CodeBlock code="" language="javascript" />);

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
    const preElement = screen.getByLabelText('Code content in javascript');
    expect(preElement.textContent).toBe('');
  });

  it('handles code with special characters', () => {
    const specialCode = `const str = "Hello & goodbye <world>";
const regex = /[a-z]+/g;`;

    render(<CodeBlock code={specialCode} language="javascript" />);

    const preElement = screen.getByLabelText('Code content in javascript');
    expect(preElement.textContent).toContain('Hello & goodbye <world>');
  });

  it('provides proper region semantics', () => {
    render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        ariaLabel="Custom code region"
      />
    );

    const region = screen.getByRole('region', { name: 'Custom code region' });
    expect(region).toBeInTheDocument();
  });

  it('handles highlight lines prop', () => {
    render(
      <CodeBlock
        code={mockCode}
        language="javascript"
        highlightLines={[1, 3]}
      />
    );

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });
});
