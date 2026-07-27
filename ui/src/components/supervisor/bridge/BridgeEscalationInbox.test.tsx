/**
 * BridgeEscalationInbox — test file covering:
 * 1. Collapse same-conditionKey rows
 * 2. Machine-owned card → "Open" action instead of Jump
 * 3. Session-matched card → Jump action
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Escalation } from '@/stores/supervisorStore';
import type { Session } from '@/types/session';

const decideEscalation = vi.fn().mockResolvedValue(true);
const resolveEscalation = vi.fn().mockResolvedValue(true);
let sessionStoreMockSessions: Session[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: any) => unknown) =>
    sel({
      decideEscalation,
      resolveEscalation,
      landEpic: vi.fn(),
      resolvedEscalations: [],
      promoteTodo: vi.fn(),
      todosByProject: {},
    }),
}));

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: (s: any) => unknown) =>
    sel({ sessions: sessionStoreMockSessions }),
}));

import { BridgeEscalationInbox } from './BridgeEscalationInbox';

function esc(p: Partial<Escalation>): Escalation {
  return {
    id: p.id ?? 'e1',
    project: 'P',
    session: 'worker-1',
    kind: 'decision',
    questionText: 'pick one',
    status: 'open',
    createdAt: 1,
    ...p,
  } as Escalation;
}

beforeEach(() => {
  decideEscalation.mockClear();
  resolveEscalation.mockClear();
  sessionStoreMockSessions = [];
});

describe('BridgeEscalationInbox', () => {
  it('collapses 3 escalations with same conditionKey into 1 card + renders the count badge', () => {
    const escalations = [
      esc({ id: 'e1', conditionKey: 'infra-park:x', createdAt: 100 }),
      esc({ id: 'e2', conditionKey: 'infra-park:x', createdAt: 200 }),
      esc({ id: 'e3', conditionKey: 'infra-park:x', createdAt: 150 }),
      esc({ id: 'e4', conditionKey: null }),
    ];
    render(
      <BridgeEscalationInbox escalations={escalations} serverScope="local" />
    );

    const inbox = screen.getByTestId('bridge-escalation-inbox');
    const cardRows = inbox.querySelectorAll('div.rounded.border.border-gray-200');
    expect(cardRows).toHaveLength(2);

    const badge = screen.getByText('×3');
    expect(badge).toBeInTheDocument();
  });

  it('renders Open button for machine-owned card (no session match) + calling onSelectTodo', () => {
    sessionStoreMockSessions = [];
    const onSelectTodo = vi.fn();
    const escalations = [
      esc({
        id: 'e1',
        session: 'coordinator',
        todoId: 't1',
        conditionKey: null,
      }),
    ];

    render(
      <BridgeEscalationInbox
        escalations={escalations}
        serverScope="local"
        onSelectTodo={onSelectTodo}
      />
    );

    const openButton = screen.getByTestId('escalation-open-todo');
    expect(openButton).toBeInTheDocument();
    expect(openButton).toHaveTextContent('Open');

    fireEvent.click(openButton);
    expect(onSelectTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' })
    );

    expect(screen.queryByText('Jump')).not.toBeInTheDocument();
  });

  it('renders Jump button for session-matched card', () => {
    sessionStoreMockSessions = [
      { project: 'P', name: 'worker-1', serverId: 'local' } as Session,
    ];
    const onJump = vi.fn();
    const escalations = [
      esc({
        id: 'e1',
        project: 'P',
        session: 'worker-1',
        conditionKey: null,
      }),
    ];

    render(
      <BridgeEscalationInbox
        escalations={escalations}
        serverScope="local"
        onJump={onJump}
      />
    );

    const jumpButton = screen.getByText('Jump');
    expect(jumpButton).toBeInTheDocument();
    expect(jumpButton).toHaveAttribute('title', 'Jump to session');

    fireEvent.click(jumpButton);
    expect(onJump).toHaveBeenCalledWith('P', 'worker-1');

    expect(screen.queryByTestId('escalation-open-todo')).not.toBeInTheDocument();
  });
});
