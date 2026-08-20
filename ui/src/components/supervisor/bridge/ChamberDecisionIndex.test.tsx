import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChamberDecisionIndex, formatDecidedAt } from './ChamberDecisionIndex';
import type { BridgeChamberDeliberation } from '../../../types/campaign';

function makeEntry(role: string, content: string, phase: BridgeChamberDeliberation['proposals'][number]['phase']) {
  return { phase, role, model: 'claude', content, createdAt: 1000 };
}

const decisionOne: BridgeChamberDeliberation = {
  sessionId: 'session-one',
  outcome: 'decision',
  chosenCandidate: 'Adopt proposal A',
  strongestDissent: null,
  refiningGuidance: null,
  decidedAtSha: 'sha-one',
  decidedAt: 1700000000000,
  proposals: [makeEntry('president', 'first decision proposal content', 'propose')],
  vetoes: [],
  wargame: [],
  decision: [makeEntry('president', 'first decision final content', 'decide')],
};

const decisionTwo: BridgeChamberDeliberation = {
  sessionId: 'session-two',
  outcome: 'inaction',
  chosenCandidate: null,
  strongestDissent: 'General B dissented on scope',
  refiningGuidance: null,
  decidedAtSha: 'sha-two',
  decidedAt: 1700003600000,
  proposals: [makeEntry('general-b', 'second decision proposal content', 'propose')],
  vetoes: [],
  wargame: [],
  decision: [makeEntry('president', 'second decision final content', 'decide')],
};

describe('ChamberDecisionIndex', () => {
  it('renders one row per decision with its timestamp, outcome, and summary', () => {
    render(<ChamberDecisionIndex decisions={[decisionOne, decisionTwo]} />);

    const rows = screen.getAllByTestId('chamber-decision-row');
    expect(rows).toHaveLength(2);

    expect(rows[0].textContent).toContain(formatDecidedAt(decisionOne.decidedAt));
    expect(rows[0].textContent).toContain(decisionOne.outcome);
    expect(rows[0].textContent).toContain('Adopt proposal A');

    expect(rows[1].textContent).toContain(formatDecidedAt(decisionTwo.decidedAt));
    expect(rows[1].textContent).toContain(decisionTwo.outcome);
    expect(rows[1].textContent).toContain('General B dissented on scope');
  });

  it('drills into the clicked decision and returns to the list', () => {
    render(<ChamberDecisionIndex decisions={[decisionOne, decisionTwo]} />);

    const rows = screen.getAllByTestId('chamber-decision-row');
    fireEvent.click(rows[1]);

    expect(screen.queryByText('second decision final content')).not.toBeNull();
    expect(screen.queryByText('first decision final content')).toBeNull();

    fireEvent.click(screen.getByText('Back to decisions'));

    expect(screen.getAllByTestId('chamber-decision-row')).toHaveLength(2);
  });
});
