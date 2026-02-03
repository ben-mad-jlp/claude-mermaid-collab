import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleDetails, CollapsibleSummary } from '../CollapsibleDetails';

describe('CollapsibleDetails', () => {
  it('should render collapsed by default', () => {
    render(
      <CollapsibleDetails>
        <CollapsibleSummary>Click to expand</CollapsibleSummary>
        <p>Hidden content</p>
      </CollapsibleDetails>
    );

    const content = screen.getByTestId('collapsible-content');
    expect(content.getAttribute('style')).toContain('max-height: 0');
  });

  it('should expand on click', () => {
    render(
      <CollapsibleDetails>
        <CollapsibleSummary>Expandable Section</CollapsibleSummary>
        <p>Hidden content</p>
      </CollapsibleDetails>
    );

    const summaryButton = screen.getByTestId('collapsible-summary');
    fireEvent.click(summaryButton);

    const content = screen.getByTestId('collapsible-content');
    expect(content.getAttribute('style')).not.toContain('max-height: 0');
  });

  it('should have correct aria-expanded attribute', () => {
    render(
      <CollapsibleDetails>
        <CollapsibleSummary>Section</CollapsibleSummary>
        <p>Content</p>
      </CollapsibleDetails>
    );

    const summaryButton = screen.getByTestId('collapsible-summary');
    expect(summaryButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(summaryButton);
    expect(summaryButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('should have proper styling', () => {
    render(
      <CollapsibleDetails>
        <CollapsibleSummary>Styled Section</CollapsibleSummary>
        <p>Content</p>
      </CollapsibleDetails>
    );

    const details = screen.getByTestId('collapsible-details');
    expect(details.className).toContain('border');
    expect(details.className).toContain('rounded-lg');

    const summary = screen.getByTestId('collapsible-summary');
    expect(summary.className).toContain('bg-gray-50');
  });

  it('should respect open prop', () => {
    render(
      <CollapsibleDetails open={true}>
        <CollapsibleSummary>Initially Open</CollapsibleSummary>
        <p>Content</p>
      </CollapsibleDetails>
    );

    const content = screen.getByTestId('collapsible-content');
    expect(content.getAttribute('style')).not.toContain('max-height: 0');
  });
});
