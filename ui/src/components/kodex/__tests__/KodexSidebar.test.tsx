import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { KodexSidebar } from '../KodexSidebar';

describe('KodexSidebar', () => {
  it('should render the Kodex header', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('Kodex')).toBeInTheDocument();
    expect(screen.getByText('Project Knowledge')).toBeInTheDocument();
  });

  it('should render all navigation items', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Topics')).toBeInTheDocument();
    expect(screen.getByText('Drafts')).toBeInTheDocument();
    expect(screen.getByText('Flags')).toBeInTheDocument();
  });

  it('should render the Graph link', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    const graphLink = screen.getByText('Graph');
    expect(graphLink).toBeInTheDocument();
  });

  it('should have Graph link with correct href', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    const graphLink = screen.getByText('Graph');
    expect(graphLink.closest('a')).toHaveAttribute('href', '/kodex/graph');
  });

  it('should apply active styling to current route', () => {
    render(
      <MemoryRouter initialEntries={['/kodex/graph']}>
        <KodexSidebar />
      </MemoryRouter>
    );

    const graphLink = screen.getByText('Graph').closest('a');
    expect(graphLink).toHaveClass('bg-blue-100', 'text-blue-700');
  });

  it('should have Graph link with icon', () => {
    const { container } = render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    const graphLink = screen.getByText('Graph').closest('a');
    const icon = graphLink?.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('w-5', 'h-5');
  });

  it('should place Graph link after Topics link', () => {
    const { container } = render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    // Get all nav links in order
    const nav = container.querySelector('nav');
    const links = nav ? Array.from(nav.querySelectorAll('a')) : [];

    const topicsLinkElement = links.find((link) => link.textContent?.includes('Topics'));
    const graphLinkElement = links.find((link) => link.textContent?.includes('Graph'));

    // Verify both exist
    expect(topicsLinkElement).toBeInTheDocument();
    expect(graphLinkElement).toBeInTheDocument();

    // Graph should come after Topics in the nav
    const topicsIndex = links.indexOf(topicsLinkElement!);
    const graphIndex = links.indexOf(graphLinkElement!);
    expect(graphIndex).toBeGreaterThan(topicsIndex);
  });

  it('should have consistent styling with other nav items', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    const topicsLink = screen.getByText('Topics').closest('a');
    const graphLink = screen.getByText('Graph').closest('a');

    // Both should have the flex layout and rounded classes
    expect(topicsLink).toHaveClass('flex', 'items-center', 'gap-3', 'px-3', 'py-2', 'rounded-lg');
    expect(graphLink).toHaveClass('flex', 'items-center', 'gap-3', 'px-3', 'py-2', 'rounded-lg');
  });

  it('should render Back to Collab link', () => {
    render(
      <BrowserRouter>
        <KodexSidebar />
      </BrowserRouter>
    );

    const backLink = screen.getByText('Back to Collab');
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest('a')).toHaveAttribute('href', '/');
  });
});
