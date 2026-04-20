import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import EditorAreaDropZones from '../EditorAreaDropZones';

describe('EditorAreaDropZones', () => {
  const renderInCtx = () =>
    render(
      <DndContext>
        <EditorAreaDropZones />
      </DndContext>,
    );

  it('renders both half zones with correct data.zone values and testids', () => {
    renderInCtx();
    const left = screen.getByTestId('editor-half-left');
    const right = screen.getByTestId('editor-half-right');
    expect(left.getAttribute('data-zone')).toBe('editor-half-left');
    expect(right.getAttribute('data-zone')).toBe('editor-half-right');
  });

  it('has pointer-events:none by default (not dragging)', () => {
    renderInCtx();
    expect((screen.getByTestId('editor-half-left') as HTMLElement).style.pointerEvents).toBe('none');
    expect((screen.getByTestId('editor-half-right') as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('places zones at the correct sides with 50% widths', () => {
    renderInCtx();
    const left = screen.getByTestId('editor-half-left');
    const right = screen.getByTestId('editor-half-right');
    expect(left.className).toContain('left-0');
    expect(left.className).toContain('w-1/2');
    expect(right.className).toContain('right-0');
    expect(right.className).toContain('w-1/2');
  });

  it('root has pointer-events-none wrapper so idle zones do not block editor clicks', () => {
    renderInCtx();
    const root = screen.getByTestId('editor-drop-zones');
    expect(root.className).toContain('pointer-events-none');
    expect(root.hasAttribute('data-dragging')).toBe(false);
  });
});
