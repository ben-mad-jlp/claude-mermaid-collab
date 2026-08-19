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
const landEpic = vi.fn();
let sessionStoreMockSessions: Session[] = [];
let mockLandJobs: Record<string, any> = {};

vi.mock('@/stores/supervisorStore', async () => {
  const actual = await vi.importActual('@/stores/supervisorStore') as typeof import('@/stores/supervisorStore');
  return {
    useSupervisorStore: (sel: (s: any) => unknown) =>
      sel({
        decideEscalation,
        resolveEscalation,
        landEpic,
        resolvedEscalations: [],
        promoteTodo: vi.fn(),
        todosByProject: {},
        landJobs: mockLandJobs,
      }),
    runningLandJobFor: actual.runningLandJobFor,
  };
});

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: (s: any) => unknown) =>
    sel({ sessions: sessionStoreMockSessions }),
}));

let nicknameMap: Record<string, string> = {};
vi.mock('@/lib/nicknames', () => ({
  useProjectNicknames: () => nicknameMap,
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
  landEpic.mockClear();
  sessionStoreMockSessions = [];
  nicknameMap = {};
  mockLandJobs = {};
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

  it('renders the nickname for a serve-cap criterion id while keeping the raw id in data-raw-text', () => {
    const questionText = 'Serve cap reached for [serve-cap:crit_1dd86268_6_abc123]';
    nicknameMap = { crit_1dd86268_6_abc123: 'brave-otter' };
    const escalations = [
      esc({
        id: 'e1',
        project: 'P',
        questionText,
        conditionKey: null,
      }),
    ];

    render(
      <BridgeEscalationInbox
        escalations={escalations}
        serverScope="local"
        project="P"
      />
    );

    const questionEl = screen.getByTestId('escalation-question-text');
    expect(questionEl).toHaveTextContent('brave-otter');
    expect(questionEl).toHaveAttribute('data-raw-text', questionText);
  });

  it('replaces the Land button with the running job reference while a land is in flight', () => {
    const escalationId = 'e-land-in-flight';
    const jobId = 'job-abcdef01-full-id';
    const escalations = [
      esc({
        id: escalationId,
        kind: 'epic-ready-to-land',
        conditionKey: null,
      }),
    ];

    // Set up a running land job for this escalation
    mockLandJobs = {
      [escalationId]: {
        id: jobId,
        targetId: escalationId,
        status: 'running',
        phase: 'merging',
      },
    };

    render(
      <BridgeEscalationInbox
        escalations={escalations}
        serverScope="local"
      />
    );

    // Assert in-flight control is present
    const inFlightControl = screen.getByTestId('land-in-flight');
    expect(inFlightControl).toBeInTheDocument();
    expect(inFlightControl).toHaveAttribute('disabled');
    expect(inFlightControl).toHaveTextContent('Landing…');
    expect(inFlightControl).toHaveTextContent(jobId.slice(0, 8));
    expect(inFlightControl).toHaveTextContent('merging');

    // Assert landEpic is not called when clicking the in-flight control
    fireEvent.click(inFlightControl);
    expect(landEpic).not.toHaveBeenCalled();

    // Verify the Dismiss button is still present and reachable
    const dismissButton = screen.getByText('Dismiss');
    expect(dismissButton).toBeInTheDocument();
  });

  it('still renders the emerald Land button when there is no running land job', () => {
    const escalationId = 'e-no-job';
    const escalations = [
      esc({
        id: escalationId,
        kind: 'epic-ready-to-land',
        conditionKey: null,
      }),
    ];

    // mockLandJobs is already empty from beforeEach

    render(
      <BridgeEscalationInbox
        escalations={escalations}
        serverScope="local"
      />
    );

    // Assert in-flight control is not present
    expect(screen.queryByTestId('land-in-flight')).not.toBeInTheDocument();

    // Assert the emerald Land button is present
    const landButton = screen.getByText('Land');
    expect(landButton).toBeInTheDocument();
    expect(landButton).toHaveClass('bg-emerald-600');
    expect(landButton).not.toHaveAttribute('disabled');

    // Assert clicking Land calls landEpic
    fireEvent.click(landButton);
    expect(landEpic).toHaveBeenCalledWith('local', 'P', escalationId);
  });
});
