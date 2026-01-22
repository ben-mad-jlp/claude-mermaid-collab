/**
 * Accordion Component Tests
 *
 * Tests for:
 * - Rendering multiple accordion sections
 * - Expand/collapse functionality
 * - Single vs multiple open sections (allowMultiple)
 * - Different variants (default, flush, outlined)
 * - Accessibility features
 * - Hidden state
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Accordion from '../Accordion';

describe('Accordion', () => {
  const mockSections = [
    {
      id: 'section-1',
      title: 'Section One',
      content: { type: 'Markdown', props: { content: 'Content one' } },
      expanded: false,
    },
    {
      id: 'section-2',
      title: 'Section Two',
      content: { type: 'Markdown', props: { content: 'Content two' } },
      expanded: false,
    },
    {
      id: 'section-3',
      title: 'Section Three',
      content: { type: 'Markdown', props: { content: 'Content three' } },
      expanded: false,
    },
  ];

  it('renders all accordion sections', () => {
    render(<Accordion sections={mockSections} />);

    expect(screen.getByText('Section One')).toBeInTheDocument();
    expect(screen.getByText('Section Two')).toBeInTheDocument();
    expect(screen.getByText('Section Three')).toBeInTheDocument();
  });

  it('expands section on click', async () => {
    const user = userEvent.setup();

    render(<Accordion sections={mockSections} />);

    const firstButton = screen.getByText('Section One').closest('button');
    await user.click(firstButton!);

    expect(screen.getByText('Content one')).toBeInTheDocument();
  });

  it('collapses section on second click', async () => {
    const user = userEvent.setup();

    render(<Accordion sections={mockSections} />);

    const firstButton = screen.getByText('Section One').closest('button');

    // Expand
    await user.click(firstButton!);
    expect(screen.getByText('Content one')).toBeInTheDocument();

    // Collapse
    await user.click(firstButton!);
    expect(screen.queryByText('Content one')).not.toBeInTheDocument();
  });

  it('allows only one section open when allowMultiple is false', async () => {
    const user = userEvent.setup();

    render(<Accordion sections={mockSections} allowMultiple={false} />);

    const firstButton = screen.getByText('Section One').closest('button');
    const secondButton = screen.getByText('Section Two').closest('button');

    // Open first
    await user.click(firstButton!);
    expect(screen.getByText('Content one')).toBeInTheDocument();

    // Open second should close first
    await user.click(secondButton!);
    expect(screen.queryByText('Content one')).not.toBeInTheDocument();
    expect(screen.getByText('Content two')).toBeInTheDocument();
  });

  it('allows multiple sections open when allowMultiple is true', async () => {
    const user = userEvent.setup();

    render(<Accordion sections={mockSections} allowMultiple={true} />);

    const firstButton = screen.getByText('Section One').closest('button');
    const secondButton = screen.getByText('Section Two').closest('button');

    // Open first
    await user.click(firstButton!);
    expect(screen.getByText('Content one')).toBeInTheDocument();

    // Open second - first should remain open
    await user.click(secondButton!);
    expect(screen.getByText('Content one')).toBeInTheDocument();
    expect(screen.getByText('Content two')).toBeInTheDocument();
  });

  it('starts with sections expanded when expanded prop is true', () => {
    const expandedSections = [
      {
        id: 'exp-1',
        title: 'Expanded Section',
        content: { type: 'Markdown', props: { content: 'Already expanded' } },
        expanded: true,
      },
    ];

    render(<Accordion sections={expandedSections} />);

    expect(screen.getByText('Already expanded')).toBeInTheDocument();
  });

  it('does not render when hidden is true', () => {
    const { container } = render(
      <Accordion sections={mockSections} hidden={true} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('does not render when sections is empty', () => {
    const { container } = render(<Accordion sections={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('applies default variant styling', () => {
    const { container } = render(
      <Accordion sections={mockSections} variant="default" />
    );

    const sections = container.querySelectorAll('div[class*="border"]');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('applies flush variant styling', () => {
    const { container } = render(
      <Accordion sections={mockSections} variant="flush" />
    );

    expect(container.querySelector('div')).toHaveClass('divide-y');
  });

  it('applies outlined variant styling', () => {
    const { container } = render(
      <Accordion sections={mockSections} variant="outlined" />
    );

    // Get the role region and then get its first child section
    const accordion = container.querySelector('[role="region"]');
    const firstSection = accordion?.querySelector('div:first-child');
    expect(firstSection).toHaveClass('border');
    expect(firstSection).toHaveClass('rounded-lg');
  });

  it('has correct semantic role', () => {
    const { container } = render(<Accordion sections={mockSections} />);

    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
  });

  it('section buttons have aria-expanded attribute', async () => {
    const user = userEvent.setup();

    render(<Accordion sections={mockSections} />);

    const firstButton = screen.getByText('Section One').closest('button');

    expect(firstButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(firstButton!);

    expect(firstButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('section buttons have aria-controls attribute', () => {
    render(<Accordion sections={mockSections} />);

    const firstButton = screen.getByText('Section One').closest('button');

    expect(firstButton).toHaveAttribute(
      'aria-controls',
      'accordion-content-section-1'
    );
  });

  it('applies custom className', () => {
    const { container } = render(
      <Accordion sections={mockSections} className="custom-accordion" />
    );

    const accordion = container.querySelector('[role="region"]');
    expect(accordion).toHaveClass('custom-accordion');
  });

  it('renders content when section is expanded', async () => {
    const user = userEvent.setup();
    const sectionsWithDifferentContent = [
      {
        id: 'content-1',
        title: 'Custom Content',
        content: { type: 'Markdown', props: { content: 'Custom content text' } },
        expanded: false,
      },
    ];

    render(<Accordion sections={sectionsWithDifferentContent} />);

    const button = screen.getByText('Custom Content').closest('button');
    await user.click(button!);

    expect(screen.getByText('Custom content text')).toBeInTheDocument();
  });

  it('toggles icon on expand/collapse', async () => {
    const user = userEvent.setup();

    const { container } = render(<Accordion sections={mockSections} />);

    const buttons = container.querySelectorAll('button');
    const firstButton = buttons[0];
    const svg = firstButton.querySelector('svg');

    // Initially collapsed
    expect(svg).toHaveClass('-rotate-90');

    await user.click(firstButton);

    // After expansion
    expect(svg).not.toHaveClass('-rotate-90');
  });

  it('handles multiple expanded sections initially', () => {
    const multiplExpanded = [
      {
        id: 'multi-1',
        title: 'Expanded One',
        content: { type: 'Markdown', props: { content: 'Content 1' } },
        expanded: true,
      },
      {
        id: 'multi-2',
        title: 'Expanded Two',
        content: { type: 'Markdown', props: { content: 'Content 2' } },
        expanded: true,
      },
    ];

    render(<Accordion sections={multiplExpanded} allowMultiple={true} />);

    expect(screen.getByText('Content 1')).toBeInTheDocument();
    expect(screen.getByText('Content 2')).toBeInTheDocument();
  });
});
