/**
 * BridgeDashboard — focal escalation overlay (D3 no-op).
 *
 * The focal DecisionCard is a deck-scoped sibling of SplitDeck, overlaid
 * via the relative h-full parent. It mounts only when the flag is on and
 * a focal escalation is set, and it lives OUTSIDE the three-column structure
 * (not inside any column). This test verifies the tree structure and the
 * visibility gate.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// --- Fake WS client. ---
const connectHandlers = new Set<() => void>();
const messageHandlers = new Set<(msg: any) => void>();
const fakeClient = {
  onConnect: (h: () => void) => {
    connectHandlers.add(h);
    return { unsubscribe: () => connectHandlers.delete(h) };
  },
  onMessage: (h: (msg: any) => void) => {
    messageHandlers.add(h);
    return { unsubscribe: () => messageHandlers.delete(h) };
  },
};
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => fakeClient,
}));

// --- Stub presentational children. ---
vi.mock('./SplitDeck', () => ({ SplitDeck: () => <div data-testid="bridge-split-deck" /> }));
vi.mock('./focal/DecisionCard', () => ({
  DecisionCard: ({ escalation }: any) => <div data-testid="focal-decision-card">{escalation.id}</div>,
}));

// --- Stub hooks. ---
vi.mock('@/hooks/useDiveIn', () => ({
  useDiveIn: () => vi.fn(),
  useSelectSessionInPlace: () => vi.fn(),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/config/featureFlags', () => ({ useFeatureFlags: () => ({ jsonRenderDecisionCard: true }) }));

import { BridgeDashboard } from './BridgeDashboard';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useDeckStore } from '@/stores/deckStore';

const loadEscalations = vi.fn(async () => {});
const loadProjectTodos = vi.fn(async () => {});
const loadAudit = vi.fn(async () => {});
const loadRequirements = vi.fn(async () => {});
const loadCoverage = vi.fn(async () => {});

beforeEach(() => {
  connectHandlers.clear();
  messageHandlers.clear();
  loadEscalations.mockClear();
  loadProjectTodos.mockClear();
  loadAudit.mockClear();
  loadRequirements.mockClear();
  loadCoverage.mockClear();

  useUIStore.setState({ activeProject: 'P' } as any);
  useSessionStore.setState({ currentSession: { project: 'P', serverId: 'local' } } as any);
  useSupervisorStore.setState({
    escalations: [
      {
        id: 'esc-123',
        project: 'P',
        session: 'worker-1',
        kind: 'blocker',
        questionText: 'Test escalation',
        status: 'open',
        createdAt: Date.now(),
      },
    ],
    supervised: [],
    todosByProject: {},
    auditByProject: {},
    unlandedEpicsByProject: {},
    requirementsByProject: {},
    coverageByProject: {},
    watchedProjects: [],
    loadEscalations,
    loadProjectTodos,
    loadAudit,
    loadRequirements,
    loadCoverage,
  } as any);
});

describe('BridgeDashboard focal escalation overlay', () => {
  it('Test A: renders the focal DecisionCard as a deck sibling when the flag is on and a focal escalation is set', () => {
    useDeckStore.setState({ focalEscalationId: 'esc-123' } as any);

    const { getByTestId } = render(<BridgeDashboard />);

    // Both elements exist.
    const deck = getByTestId('bridge-split-deck');
    const card = getByTestId('focal-decision-card');

    expect(deck).toBeInTheDocument();
    expect(card).toBeInTheDocument();

    // The card is a FOLLOWING SIBLING of the deck (both children of the same parent).
    expect(deck.parentElement).toBe(card.parentElement);
    expect(deck.nextElementSibling).toBe(card);

    // The parent carries `relative` for the overlay.
    expect(deck.parentElement?.className).toContain('relative');
  });

  it('Test B: does not render the focal DecisionCard when focalEscalationId is null', () => {
    useDeckStore.setState({ focalEscalationId: null } as any);

    const { getByTestId, queryByTestId } = render(<BridgeDashboard />);

    // Deck exists.
    expect(getByTestId('bridge-split-deck')).toBeInTheDocument();

    // Card does not.
    expect(queryByTestId('focal-decision-card')).not.toBeInTheDocument();
  });
});
