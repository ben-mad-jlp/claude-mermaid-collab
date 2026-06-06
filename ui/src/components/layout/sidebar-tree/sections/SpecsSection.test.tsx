import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpecsSection } from './SpecsSection';
import type { TreeNode } from '../getActionsForNode';

const SPEC_NODE: TreeNode = { id: 'spec-sheet-/p', kind: 'spec', name: 'Spec Sheet' };

function renderSection(overrides: Partial<React.ComponentProps<typeof SpecsSection>> = {}) {
  const props: React.ComponentProps<typeof SpecsSection> = {
    nodes: [SPEC_NODE],
    collapsed: false,
    forceExpanded: false,
    onToggle: vi.fn(),
    showDeprecated: false,
    searchQuery: '',
    visibleNodes: new Set<string>(),
    multiSelection: { ids: new Set<string>() },
    isSelected: () => false,
    handleNodeClick: vi.fn(),
    openNode: vi.fn(),
    openPermanent: vi.fn(),
    openPreview: vi.fn(),
    handleNodeContextMenu: vi.fn(),
    setSelection: vi.fn(),
    // Mirror ArtifactTree.toTabDescriptor for the spec kind.
    toTabDescriptor: (n: TreeNode) =>
      n.kind === 'spec' ? { id: n.id, kind: 'spec' as const, artifactId: n.id, name: n.name } : null,
    ...overrides,
  };
  return { props, ...render(<SpecsSection {...props} />) };
}

describe('SpecsSection', () => {
  it('lists the Spec Sheet node under a "Spec Sheets" section', () => {
    renderSection();
    expect(screen.getByText('Spec Sheets')).toBeTruthy();
    expect(screen.getByText('Spec Sheet')).toBeTruthy();
  });

  it('renders nothing when there are no spec nodes', () => {
    const { container } = renderSection({ nodes: [] });
    expect(container.firstChild).toBeNull();
  });

  it('opens a kind:"spec" tab (→ SpecSheetPane) on activating the node', () => {
    const openPermanent = vi.fn();
    renderSection({ openPermanent });
    fireEvent.doubleClick(screen.getByText('Spec Sheet'));
    expect(openPermanent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'spec', artifactId: 'spec-sheet-/p' }));
  });
});
