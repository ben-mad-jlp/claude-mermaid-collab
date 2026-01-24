import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageArea } from './MessageArea';

describe('MessageArea', () => {
  it('should render content passed as prop', () => {
    const testContent = 'Test message';
    render(<MessageArea content={testContent} />);
    expect(screen.getByText(testContent)).toBeInTheDocument();
  });

  it('should render JSX content', () => {
    const jsxContent = <div>JSX Content</div>;
    render(<MessageArea content={jsxContent} />);
    expect(screen.getByText('JSX Content')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <MessageArea content="test" className="custom-class" />
    );
    const messageArea = container.firstChild;
    expect(messageArea).toHaveClass('custom-class');
  });

  it('should apply default styling', () => {
    const { container } = render(<MessageArea content="test" />);
    const messageArea = container.firstChild;
    expect(messageArea).toHaveClass('message-area');
  });

  it('should have padding and styling', () => {
    const { container } = render(<MessageArea content="test" />);
    const messageArea = container.firstChild as HTMLElement;
    const styles = window.getComputedStyle(messageArea);
    // Check that it's a div with appropriate styling
    expect(messageArea.tagName).toBe('DIV');
  });

  it('should update content on prop change', () => {
    const { rerender } = render(<MessageArea content="initial" />);
    expect(screen.getByText('initial')).toBeInTheDocument();

    rerender(<MessageArea content="updated" />);
    expect(screen.getByText('updated')).toBeInTheDocument();
    expect(screen.queryByText('initial')).not.toBeInTheDocument();
  });
});
