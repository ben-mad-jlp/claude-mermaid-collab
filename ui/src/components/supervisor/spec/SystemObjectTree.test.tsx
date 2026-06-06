/**
 * SystemObjectTree — proves the per-node stale glyph (todo 9fd5fce8) renders for a
 * drifted object and is absent otherwise.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SystemObjectTree } from './SystemObjectTree';
import type { SystemObjectNode, CoverageRollup } from '@/stores/supervisorStore';

function obj(id: string, name: string): SystemObjectNode {
  return { id, typeId: 'pump', typeVersion: 1, parentObjectId: null, qty: 1, name, attributes: {}, currentRevisionId: null };
}

const coverage: CoverageRollup = {
  total: 2,
  covered: 1,
  partial: 0,
  uncovered: 1,
  stale: 1,
  byObject: [
    { objectId: 'o1', name: 'Pump', typeId: 'pump', state: 'covered', todoCount: 1, doneCount: 1, stale: true },
    { objectId: 'o2', name: 'Valve', typeId: 'valve', state: 'uncovered', todoCount: 0, doneCount: 0, stale: false },
  ],
};

describe('SystemObjectTree stale glyph', () => {
  it('renders a stale glyph only on the drifted node', () => {
    render(
      <SystemObjectTree
        objects={[obj('o1', 'Pump'), obj('o2', 'Valve')]}
        coverage={coverage}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    const glyphs = screen.getAllByTestId('system-object-stale');
    expect(glyphs).toHaveLength(1); // only o1 is stale
    expect(glyphs[0].className).toContain('warning'); // amber, never red
  });

  it('renders no stale glyph when nothing has drifted', () => {
    const clean: CoverageRollup = {
      ...coverage,
      stale: 0,
      byObject: coverage.byObject.map((o) => ({ ...o, stale: false })),
    };
    render(
      <SystemObjectTree objects={[obj('o1', 'Pump')]} coverage={clean} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(screen.queryByTestId('system-object-stale')).toBeNull();
  });
});
