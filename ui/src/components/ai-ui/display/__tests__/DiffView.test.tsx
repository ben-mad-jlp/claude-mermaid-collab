import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, describe, it, vi } from 'vitest';
import { DiffView } from '../DiffView';

describe('DiffView Component', () => {
  const beforeCode = `function hello() {
  console.log("Hello");
  return true;
}`;

  const afterCode = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

  it('renders diff view with before and after code', () => {
    render(
      <DiffView before={beforeCode} after={afterCode} language="javascript" />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('displays "No changes" when before and after are identical', () => {
    render(
      <DiffView before={beforeCode} after={beforeCode} />
    );

    expect(screen.getByText('No changes detected')).toBeInTheDocument();
  });

  it('shows file name when provided', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        fileName="main.js"
        language="javascript"
      />
    );

    expect(screen.getByText('main.js')).toBeInTheDocument();
  });

  it('displays language label', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        language="javascript"
      />
    );

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument();
  });

  it('supports split view mode', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        mode="split"
        language="javascript"
      />
    );

    const splitButton = screen.getByLabelText('Split view');
    expect(splitButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports unified view mode', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        mode="unified"
        language="javascript"
      />
    );

    const unifiedButton = screen.getByLabelText('Unified view');
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows toggling between split and unified views', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        mode="split"
        language="javascript"
      />
    );

    const splitButton = screen.getByLabelText('Split view');
    const unifiedButton = screen.getByLabelText('Unified view');

    expect(splitButton).toHaveAttribute('aria-pressed', 'true');
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(unifiedButton);

    expect(splitButton).toHaveAttribute('aria-pressed', 'false');
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('displays additions and removals legend', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        language="javascript"
      />
    );

    expect(screen.getByText('Additions')).toBeInTheDocument();
    expect(screen.getByText('Removals')).toBeInTheDocument();
  });

  it('provides accessibility region label', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        language="javascript"
        ariaLabel="Code diff comparison"
      />
    );

    const region = screen.getByRole('region', { name: 'Code diff comparison' });
    expect(region).toBeInTheDocument();
  });

  it('generates default region label with file name', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        fileName="utils.js"
        language="javascript"
      />
    );

    const region = screen.getByRole('region', { name: /Diff view for utils.js/i });
    expect(region).toBeInTheDocument();
  });

  it('supports different languages', () => {
    const languages = ['python', 'java', 'typescript', 'rust'];

    languages.forEach((lang) => {
      const { unmount } = render(
        <DiffView
          before={beforeCode}
          after={afterCode}
          language={lang}
        />
      );

      expect(screen.getByText(lang.toUpperCase())).toBeInTheDocument();
      unmount();
    });
  });

  it('handles large code diffs', () => {
    const largeCode = Array(100)
      .fill(0)
      .map((_, i) => `line ${i}`)
      .join('\n');

    const largeCodeModified = largeCode + '\nextra line at end';

    render(
      <DiffView
        before={largeCode}
        after={largeCodeModified}
        language="text"
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('handles special characters in code', () => {
    const beforeSpecial = 'const str = "Hello & <world>";';
    const afterSpecial = 'const str = "Hello & <world>!";';

    render(
      <DiffView
        before={beforeSpecial}
        after={afterSpecial}
        language="javascript"
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('handles empty strings', () => {
    render(
      <DiffView before="" after="new content" language="text" />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('handles multi-line differences', () => {
    const before = `Line 1
Line 2
Line 3`;

    const after = `Line 1
Modified Line 2
Line 3
Line 4`;

    render(
      <DiffView before={before} after={after} language="text" />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('respects maxHeight styling', () => {
    const { container } = render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        language="javascript"
      />
    );

    const diffContent = container.querySelector('[style*="max-height"]');
    expect(diffContent).toHaveStyle('max-height: 384px'); // max-h-96 = 384px
  });

  it('handles context lines parameter', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        contextLines={5}
        language="javascript"
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('supports collapse large lines parameter', () => {
    render(
      <DiffView
        before={beforeCode}
        after={afterCode}
        collapseLargeLines={true}
        language="javascript"
      />
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });
});
