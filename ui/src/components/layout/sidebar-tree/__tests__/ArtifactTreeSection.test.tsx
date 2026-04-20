import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactTreeSection } from '../ArtifactTreeSection';

function defaultProps() {
  return {
    id: 'images',
    title: 'Images',
    collapsed: false,
    onToggle: vi.fn(),
  };
}

describe('ArtifactTreeSection', () => {
  it('renders title and count', () => {
    const { rerender, container } = render(
      <ArtifactTreeSection {...defaultProps()} count={3}>
        <div>child</div>
      </ArtifactTreeSection>,
    );
    expect(screen.getByText('Images')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    rerender(
      <ArtifactTreeSection {...defaultProps()}>
        <div>child</div>
      </ArtifactTreeSection>,
    );
    expect(container.querySelector('span.text-gray-400.font-normal, span.dark\\:text-gray-500')).toBeNull();
    // More reliable: no element with just "3"
    expect(screen.queryByText('3')).toBeNull();
  });

  it('hides children when collapsed=true forceExpanded=false', () => {
    const { rerender } = render(
      <ArtifactTreeSection {...defaultProps()} collapsed={true} forceExpanded={false}>
        <div>CHILD</div>
      </ArtifactTreeSection>,
    );
    expect(screen.queryByText('CHILD')).toBeNull();

    rerender(
      <ArtifactTreeSection {...defaultProps()} collapsed={false}>
        <div>CHILD</div>
      </ArtifactTreeSection>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('forceExpanded overrides collapsed', () => {
    render(
      <ArtifactTreeSection {...defaultProps()} collapsed={true} forceExpanded={true}>
        <div>CHILD</div>
      </ArtifactTreeSection>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('clicking header calls onToggle', () => {
    const onToggle = vi.fn();
    render(
      <ArtifactTreeSection {...defaultProps()} onToggle={onToggle}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    fireEvent.click(screen.getByText('Images'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders headerActions', () => {
    render(
      <ArtifactTreeSection
        {...defaultProps()}
        headerActions={<button data-testid="ha">+</button>}
      >
        <div>c</div>
      </ArtifactTreeSection>,
    );
    expect(screen.getByTestId('ha')).toBeInTheDocument();
  });

  it('chevron rotation', () => {
    const { container, rerender } = render(
      <ArtifactTreeSection {...defaultProps()} collapsed={true}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    let svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') || '').toContain('-rotate-90');

    rerender(
      <ArtifactTreeSection {...defaultProps()} collapsed={false}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') || '').not.toContain('-rotate-90');
  });

  it('drag over shows ring', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <ArtifactTreeSection {...defaultProps()} onDrop={onDrop}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.dragOver(root, { dataTransfer: { types: ['Files'], files: [] } });
    expect(root.className).toContain('ring-blue-400');

    fireEvent.dragLeave(root, { dataTransfer: { types: ['Files'], files: [] } });
    expect(root.className).not.toContain('ring-blue-400');
  });

  it('dropHint valid shows ring-blue-400; invalid shows ring-red-400', () => {
    const { container, rerender } = render(
      <ArtifactTreeSection {...defaultProps()} dropHint="valid">
        <div>c</div>
      </ArtifactTreeSection>,
    );
    let root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-drop-valid')).toBe('true');
    expect(root.className).toContain('ring-blue-400');

    rerender(
      <ArtifactTreeSection {...defaultProps()} dropHint="invalid">
        <div>c</div>
      </ArtifactTreeSection>,
    );
    root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-drop-invalid')).toBe('true');
    expect(root.className).toContain('ring-red-400');
  });

  it('onDrop is called with files', async () => {
    const onDrop = vi.fn();
    const { container } = render(
      <ArtifactTreeSection {...defaultProps()} onDrop={onDrop}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    const root = container.firstChild as HTMLElement;
    const file = new File(['x'], 'a.txt');
    fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [file] } });
    // Allow the async handler to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(onDrop).toHaveBeenCalledTimes(1);
    const arg = onDrop.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg.length).toBe(1);
    expect(arg[0]).toBe(file);
  });

  it('no onDrop prop, no drag listeners throw', () => {
    const { container } = render(
      <ArtifactTreeSection {...defaultProps()}>
        <div>c</div>
      </ArtifactTreeSection>,
    );
    const root = container.firstChild as HTMLElement;
    const file = new File(['x'], 'a.txt');
    expect(() =>
      fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [file] } }),
    ).not.toThrow();
    expect(root.className).not.toContain('ring-blue-400');
    expect(root.className).not.toContain('ring-red-400');
  });
});
