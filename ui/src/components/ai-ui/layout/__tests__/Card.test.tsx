/**
 * Card Component Tests
 *
 * Tests for:
 * - Rendering card with title, subtitle, and footer
 * - Collapsible functionality
 * - Styling variations (border color, background, elevation)
 * - Hidden state
 * - Children rendering
 * - Accessibility features
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Card from '../Card';

describe('Card', () => {
  it('renders card with title', () => {
    render(
      <Card title="Test Card">
        <p>Card content</p>
      </Card>
    );

    expect(screen.getByText('Test Card')).toBeInTheDocument();
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders card with title and subtitle', () => {
    render(
      <Card title="Main Title" subtitle="Subtitle text">
        <p>Content</p>
      </Card>
    );

    expect(screen.getByText('Main Title')).toBeInTheDocument();
    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('renders card with footer', () => {
    render(
      <Card title="Title" footer="Footer text">
        <p>Content</p>
      </Card>
    );

    expect(screen.getByText('Footer text')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <Card title="Card">
        <div className="test-content">Test content</div>
      </Card>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('does not render when hidden is true', () => {
    const { container } = render(
      <Card title="Hidden Card" hidden={true}>
        <p>Content</p>
      </Card>
    );

    expect(container.firstChild).toBeNull();
  });

  it('supports collapsible functionality', async () => {
    const user = userEvent.setup();

    render(
      <Card title="Collapsible" collapsible={true}>
        <p>Collapsible content</p>
      </Card>
    );

    const collapseButton = screen.getByLabelText('Collapse');
    expect(screen.getByText('Collapsible content')).toBeInTheDocument();

    // Click to collapse
    await user.click(collapseButton);
    expect(screen.queryByText('Collapsible content')).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByLabelText('Expand'));
    expect(screen.getByText('Collapsible content')).toBeInTheDocument();
  });

  it('starts collapsed when collapsed prop is true', () => {
    render(
      <Card title="Collapsed Card" collapsible={true} collapsed={true}>
        <p>Initially collapsed content</p>
      </Card>
    );

    expect(screen.queryByText('Initially collapsed content')).not.toBeInTheDocument();
  });

  it('hides footer when collapsed', async () => {
    const user = userEvent.setup();

    render(
      <Card
        title="Card"
        footer="Footer text"
        collapsible={true}
      >
        <p>Content</p>
      </Card>
    );

    expect(screen.getByText('Footer text')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Collapse'));
    expect(screen.queryByText('Footer text')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Card title="Styled" className="custom-class">
        <p>Content</p>
      </Card>
    );

    const cardDiv = container.querySelector('div');
    expect(cardDiv).toHaveClass('custom-class');
  });

  it('has correct semantic role', () => {
    const { container } = render(
      <Card title="Semantic Card">
        <p>Content</p>
      </Card>
    );

    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
  });

  it('has accessible aria-label from title', () => {
    const { container } = render(
      <Card title="Accessible Card">
        <p>Content</p>
      </Card>
    );

    expect(container.querySelector('[aria-label="Accessible Card"]')).toBeInTheDocument();
  });

  it('collapse button has correct aria attributes', async () => {
    render(
      <Card title="Card" collapsible={true}>
        <p>Content</p>
      </Card>
    );

    const button = screen.getByLabelText('Collapse');
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // After collapse
    const user = userEvent.setup();
    await user.click(button);

    const expandButton = screen.getByLabelText('Expand');
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders without title', () => {
    render(
      <Card>
        <p>Content without title</p>
      </Card>
    );

    expect(screen.getByText('Content without title')).toBeInTheDocument();
  });

  it('applies elevation classes', () => {
    const { container, rerender } = render(
      <Card title="Card" elevation={1}>
        <p>Content</p>
      </Card>
    );

    let cardDiv = container.querySelector('div');
    expect(cardDiv).toHaveClass('shadow-sm');

    rerender(
      <Card title="Card" elevation={5}>
        <p>Content</p>
      </Card>
    );

    cardDiv = container.querySelector('div');
    expect(cardDiv).toHaveClass('shadow-xl');
  });

  it('handles border color prop', () => {
    const { container } = render(
      <Card title="Card" borderColor="rgb(59, 130, 246)">
        <p>Content</p>
      </Card>
    );

    const cardDiv = container.querySelector('[role="region"]');
    expect(cardDiv).toHaveStyle('borderColor: rgb(59, 130, 246)');
  });

  it('handles background color prop', () => {
    const { container } = render(
      <Card title="Card" backgroundColor="rgb(240, 245, 250)">
        <p>Content</p>
      </Card>
    );

    const cardDiv = container.querySelector('[role="region"]');
    expect(cardDiv).toHaveStyle('backgroundColor: rgb(240, 245, 250)');
  });
});
