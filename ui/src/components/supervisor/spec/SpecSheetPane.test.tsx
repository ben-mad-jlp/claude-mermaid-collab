/**
 * SpecSheetPane — the P1 authoring artifact. Proves the two-column pane renders
 * the object tree + promise chips, and that the `+ promise` composer (opened by
 * the `n` key) proposes a requirement with the composed spec.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SystemObjectNode, CoverageRollup, Requirement } from '@/stores/supervisorStore';

const proposeRequirement = vi.fn().mockResolvedValue(true);
const noop = vi.fn().mockResolvedValue(undefined);

const objects: SystemObjectNode[] = [
  { id: 'o1', typeId: 'pump', typeVersion: 1, parentObjectId: null, qty: 1, name: 'Pump-A2', attributes: {}, currentRevisionId: null },
];
const coverage: CoverageRollup = {
  total: 1, covered: 0, partial: 0, uncovered: 1,
  byObject: [{ objectId: 'o1', name: 'Pump-A2', typeId: 'pump', state: 'uncovered', todoCount: 0, doneCount: 0 }],
};
const requirements: Requirement[] = [
  { id: 'r1', project: 'P', epicId: null, kind: 'performance', status: 'proposed', title: 'latency', rationale: null, spec: { metric: 'latency', op: '<=', target: 150 }, supersededBy: null, linkedTodos: [], approvedBy: null, createdAt: 1, updatedAt: 1 },
];

const state = {
  systemObjectsByProject: { P: objects },
  coverageByProject: { P: coverage },
  requirementsByProject: { P: requirements },
  bomByRoot: {},
  loadSystemObjects: noop,
  loadCoverage: noop,
  loadRequirements: noop,
  loadBom: noop,
  proposeRequirement,
};

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: typeof state) => unknown) => sel(state),
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: (s: { currentSession: { serverId: string } }) => unknown) =>
    sel({ currentSession: { serverId: 'local' } }),
}));

import { SpecSheetPane } from './SpecSheetPane';

beforeEach(() => {
  proposeRequirement.mockClear();
});

describe('SpecSheetPane', () => {
  it('renders the object tree and the promise chips', () => {
    render(<SpecSheetPane project="P" />);
    expect(screen.getByTestId('spec-sheet-pane')).toBeInTheDocument();
    expect(screen.getByText('Pump-A2')).toBeInTheDocument();
    expect(screen.getByTestId('requirement-chip')).toHaveTextContent('latency · <= · 150');
  });

  it('opens the composer on "n" and proposes a requirement with the spec', () => {
    render(<SpecSheetPane project="P" />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByTestId('promise-composer')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('metric'), { target: { value: 'rps' } });
    fireEvent.change(screen.getByLabelText('op'), { target: { value: '>=' } });
    fireEvent.change(screen.getByLabelText('target'), { target: { value: '500' } });
    fireEvent.keyDown(screen.getByLabelText('target'), { key: 'Enter' });
    expect(proposeRequirement).toHaveBeenCalledWith('local', 'P', {
      title: 'rps >= 500',
      spec: { metric: 'rps', op: '>=', target: 500 },
    });
  });

  it('opens the composer from the + promise button too', () => {
    render(<SpecSheetPane project="P" />);
    fireEvent.click(screen.getByTestId('add-promise-button'));
    expect(screen.getByTestId('promise-composer')).toBeInTheDocument();
  });
});
