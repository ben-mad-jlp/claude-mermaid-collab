import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChatMarkdown } from './ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders headings', () => {
    const { container } = render(<ChatMarkdown content={'# Hello'} />);
    expect(container.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('renders inline code and fenced code blocks', () => {
    const { container } = render(
      <ChatMarkdown content={'`inline` and\n```ts\nconst x = 1;\n```'} />
    );
    expect(container.querySelector('code')).toBeTruthy();
    expect(container.querySelector('pre')).toBeTruthy();
  });

  it('renders tables via remark-gfm', () => {
    const { container } = render(
      <ChatMarkdown content={'| a | b |\n|---|---|\n| 1 | 2 |'} />
    );
    expect(container.querySelector('table')).toBeTruthy();
  });
});
