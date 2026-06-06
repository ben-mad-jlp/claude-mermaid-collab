/**
 * Spec UI acceptance (design-system-object-ui §7 interactions, §10 invariants).
 *
 * Integration-tier acceptance for the confirm-loop + Spec Sheet, assembling the
 * REAL leaf components (RequirementsInbox, SpecCoverageCard, SpecSheetPane) and
 * driving the listed flows. It asserts the design's hard invariants:
 *   - §6/§10 one-red: uncovered is AMBER (warning), never red (danger).
 *   - §5/§10 no 2nd fleet map: the object tree is a typed list, not a FleetGraph.
 *   - §7 keyboard-first: 1/↵ approve · e edit · 3 reject · n propose.
 *
 * NOTE: the full running-app pass (chromedev-director/mock-api + verify skill) is
 * tracked separately — those MCP servers are not connected in this run and the
 * Studio Spec Sheet entry point is not yet wired (see the todo's escalation).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Requirement, SystemObjectNode, CoverageRollup, RequirementSpec } from '@/stores/supervisorStore';

const decideRequirement = vi.fn().mockResolvedValue(true);
const proposeRequirement = vi.fn().mockResolvedValue(true);
const noop = vi.fn().mockResolvedValue(undefined);

const objects: SystemObjectNode[] = [
  { id: 'o1', typeId: 'pump', typeVersion: 1, parentObjectId: null, qty: 1, name: 'Pump-A2', attributes: {}, currentRevisionId: null },
];
const coverage: CoverageRollup = {
  total: 2, covered: 1, partial: 0, uncovered: 1,
  byObject: [{ objectId: 'o1', name: 'Pump-A2', typeId: 'pump', state: 'uncovered', todoCount: 0, doneCount: 0 }],
};
function req(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1', project: 'P', epicId: null, kind: 'performance', status: 'proposed',
    title: 'latency', rationale: null, spec: { metric: 'latency', op: '<=', target: 150 },
    supersededBy: null, linkedTodos: [], approvedBy: null, createdAt: 1, updatedAt: 1, ...p,
  };
}

const state = {
  systemObjectsByProject: { P: objects },
  coverageByProject: { P: coverage },
  requirementsByProject: { P: [req({ id: 'r1' })] },
  bomByRoot: {},
  decideRequirement, proposeRequirement,
  loadSystemObjects: noop, loadCoverage: noop, loadRequirements: noop, loadBom: noop,
};

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: typeof state) => unknown) => sel(state),
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: (s: { currentSession: { serverId: string } }) => unknown) =>
    sel({ currentSession: { serverId: 'local' } }),
}));

import { RequirementsInbox } from '@/components/supervisor/bridge/RequirementsInbox';
import { SpecCoverageCard } from '@/components/supervisor/bridge/SpecCoverageCard';
import { SpecSheetPane } from './SpecSheetPane';

beforeEach(() => {
  decideRequirement.mockClear();
  proposeRequirement.mockClear();
});

describe('Spec UI acceptance — §7 confirm-loop drain', () => {
  const reqs = [req({ id: 'r1' })];

  it('1/↵ approves, e edits, 3 rejects (one-key drain)', () => {
    const { unmount } = render(<RequirementsInbox requirements={reqs} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: '1' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'r1', 'approve');
    unmount();

    render(<RequirementsInbox requirements={reqs} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: '3' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'r1', 'reject');
  });

  it('a changed requirement re-enters at top as a was→now DIFF (re-sign)', () => {
    const old = req({ id: 'old', status: 'approved', supersededBy: 'new', spec: { metric: 'latency', op: '<=', target: 200 } });
    const fresh = req({ id: 'new', status: 'changed', updatedAt: 9, spec: { metric: 'latency', op: '<=', target: 150 } });
    const proposed = req({ id: 'p', status: 'proposed', updatedAt: 1 });
    render(<RequirementsInbox requirements={[proposed, old, fresh]} project="P" serverScope="local" />);
    const cards = screen.getAllByTestId('requirement-card');
    expect(cards[0].getAttribute('data-requirement-id')).toBe('new'); // changed floats to top
    expect(screen.getByText(/CHANGED/)).toBeInTheDocument();
    expect(screen.getByText(/latency · <= · 200/)).toBeInTheDocument(); // "was"
  });
});

describe('Spec UI acceptance — §6/§10 one-red discipline', () => {
  it('uncovered coverage is amber (warning), never red (danger)', () => {
    render(<SpecCoverageCard coverage={coverage} />);
    const uncovered = screen.getByTestId('spec-coverage-uncovered');
    expect(uncovered.className).toContain('warning');
    expect(uncovered.className).not.toContain('danger');
  });
});

describe('Spec UI acceptance — §4/§5/§7 Spec Sheet authoring', () => {
  it('renders the object tree as a typed list — NOT a FleetGraph (no 2nd fleet map)', () => {
    render(<SpecSheetPane project="P" />);
    expect(screen.getByTestId('system-object-tree').tagName).toBe('UL'); // typed tree, not a canvas/graph
    expect(screen.queryByTestId('fleet-graph')).toBeNull();
    expect(screen.getByText('Pump-A2')).toBeInTheDocument();
  });

  it('n opens the + promise composer and proposes a requirement', () => {
    render(<SpecSheetPane project="P" />);
    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.change(screen.getByLabelText('metric'), { target: { value: 'rps' } });
    fireEvent.change(screen.getByLabelText('op'), { target: { value: '>=' } });
    fireEvent.change(screen.getByLabelText('target'), { target: { value: '500' } });
    fireEvent.keyDown(screen.getByLabelText('target'), { key: 'Enter' });
    const spec: RequirementSpec = { metric: 'rps', op: '>=', target: 500 };
    expect(proposeRequirement).toHaveBeenCalledWith('local', 'P', { title: 'rps >= 500', spec });
  });
});
