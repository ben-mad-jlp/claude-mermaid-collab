/**
 * keyboardOwnership — integration test proving the double-fire bug is fixed.
 *
 * When a focal DecisionCard is open over a RequirementsInbox, pressing a key
 * should only fire the high-priority (focal) handler, not both.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionCard } from '../focal/DecisionCard';
import { RequirementsInbox } from '../RequirementsInbox';
import type { Requirement, Escalation } from '@/stores/supervisorStore';
import { __resetKeyboardOwners } from '@/hooks/useKeyboardOwner';

const decideEscalation = vi.fn().mockResolvedValue(true);
const decideRequirement = vi.fn().mockResolvedValue(true);
const resolveEscalation = vi.fn().mockResolvedValue(true);
const landEpic = vi.fn().mockResolvedValue(true);
const fetchEscalationBrief = vi.fn().mockResolvedValue(null);

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: {
    decideEscalation: typeof decideEscalation;
    decideRequirement: typeof decideRequirement;
    resolveEscalation: typeof resolveEscalation;
    landEpic: typeof landEpic;
    fetchEscalationBrief: typeof fetchEscalationBrief;
  }) => unknown) =>
    sel({
      decideEscalation,
      decideRequirement,
      resolveEscalation,
      landEpic,
      fetchEscalationBrief,
    }),
}));

function req(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1',
    project: 'P',
    epicId: null,
    kind: 'performance',
    status: 'proposed',
    title: 'latency',
    rationale: null,
    spec: { metric: 'latency', op: '<=', target: 150 },
    supersededBy: null,
    linkedTodos: [],
    approvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

function escalation(e: Partial<Escalation>): Escalation {
  return {
    id: e.id ?? 'esc1',
    kind: 'A/B decision',
    project: e.project ?? 'P',
    session: e.session ?? 's1',
    questionText: 'Pick one',
    options: e.options ?? [
      { id: 'a', label: 'Option A' },
      { id: 'b', label: 'Option B' },
    ],
    recommended: e.recommended ?? 'a',
    ui: null,
    createdAt: 1,
    updatedAt: 1,
    ...e,
  };
}

interface TestHarnessProps {
  requirements: Requirement[];
  escalation: Escalation | null;
}

function TestHarness({ requirements, escalation: focal }: TestHarnessProps) {
  const [showCard, setShowCard] = useState(!!focal);

  return (
    <>
      <RequirementsInbox requirements={requirements} project="P" serverScope="local" />
      {showCard && focal && (
        <DecisionCard
          escalation={focal}
          serverScope="local"
          onClose={() => setShowCard(false)}
        />
      )}
    </>
  );
}

beforeEach(() => {
  __resetKeyboardOwners();
  decideEscalation.mockClear();
  decideRequirement.mockClear();
  resolveEscalation.mockClear();
  landEpic.mockClear();
  fetchEscalationBrief.mockClear();
});

describe('Keyboard ownership (double-fire fix)', () => {
  it('focal card owns the keyboard over inbox: "1" decides escalation only', () => {
    const esc = escalation({
      id: 'esc1',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      recommended: 'a',
    });
    render(<TestHarness requirements={[req({ id: 'req1' })]} escalation={esc} />);

    fireEvent.keyDown(window, { key: '1' });

    expect(decideEscalation).toHaveBeenCalledTimes(1);
    expect(decideEscalation).toHaveBeenCalledWith('local', 'esc1', 'a');
    expect(decideRequirement).not.toHaveBeenCalled();
  });

  it('focal card owns the keyboard over inbox: Enter takes recommended', () => {
    const esc = escalation({
      id: 'esc1',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      recommended: 'b',
    });
    render(<TestHarness requirements={[req({ id: 'req1' })]} escalation={esc} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(decideEscalation).toHaveBeenCalledTimes(1);
    expect(decideEscalation).toHaveBeenCalledWith('local', 'esc1', 'b');
    expect(decideRequirement).not.toHaveBeenCalled();
  });

  it('no focal card: "1" approves inbox requirement', () => {
    render(<TestHarness requirements={[req({ id: 'req1' })]} escalation={null} />);

    fireEvent.keyDown(window, { key: '1' });

    expect(decideRequirement).toHaveBeenCalledTimes(1);
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'req1', 'approve');
    expect(decideEscalation).not.toHaveBeenCalled();
  });

  it('no focal card: "e" opens edit composer', () => {
    render(<TestHarness requirements={[req({ id: 'req1' })]} escalation={null} />);

    fireEvent.keyDown(window, { key: 'e' });

    expect(screen.getByTestId('requirement-edit-composer')).toBeInTheDocument();
    expect(decideEscalation).not.toHaveBeenCalled();
  });

  it('no focal card: "3" rejects inbox requirement', () => {
    render(<TestHarness requirements={[req({ id: 'req1' })]} escalation={null} />);

    fireEvent.keyDown(window, { key: '3' });

    expect(decideRequirement).toHaveBeenCalledTimes(1);
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'req1', 'reject');
    expect(decideEscalation).not.toHaveBeenCalled();
  });

  it('closing focal card releases ownership to inbox', () => {
    const esc = escalation({
      id: 'esc1',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      recommended: 'a',
    });

    const { rerender } = render(
      <TestHarness requirements={[req({ id: 'req1' })]} escalation={esc} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    rerender(<TestHarness requirements={[req({ id: 'req1' })]} escalation={null} />);

    decideEscalation.mockClear();

    fireEvent.keyDown(window, { key: '1' });

    expect(decideEscalation).not.toHaveBeenCalled();
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'req1', 'approve');
  });

  it('empty inbox does not own keyboard: focal still works', () => {
    const esc = escalation({
      id: 'esc1',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      recommended: 'a',
    });
    render(<TestHarness requirements={[]} escalation={esc} />);

    fireEvent.keyDown(window, { key: '1' });

    expect(decideEscalation).toHaveBeenCalledWith('local', 'esc1', 'a');
    expect(decideRequirement).not.toHaveBeenCalled();
  });
});
