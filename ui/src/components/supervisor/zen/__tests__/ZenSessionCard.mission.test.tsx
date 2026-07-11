import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

/**
 * ZenSessionCard mission-awareness: the conducting ribbon renders with the right turn,
 * and the header tint is turn-aware (daemon's-turn = green/at-rest, conductor's-move =
 * amber) — reusing the existing 3-color vocabulary, no new lane. A real escalation still
 * wins (red), so a busy-but-conducting card never hides a needs-you signal.
 */

vi.mock('@/components/layout/SessionCard', () => ({
  ClaudePixAvatar: () => <div data-testid="pix" />,
  useElapsed: () => null,
}));
vi.mock('../ZenPulseLine', () => ({ ZenPulseLine: () => <div data-testid="pulse" /> }));
vi.mock('../ZenNextPanel', () => ({ ZenNextPanel: () => <div data-testid="next" /> }));

import { ZenSessionCard } from '../ZenSessionCard';

function mission(over: any = {}): any {
  return {
    node: { id: 'm1', title: '[MISSION] ship the thing', status: 'todo' },
    ownerSession: 'bsync',
    assigneeSession: 'bsync',
    mission: { todoId: 'm1', phase: 'execute', iteration: 1, active: true, ...over.mission },
    rollup: { phase: over.mission?.phase ?? 'execute', iteration: 1, mechanical: { done: 1, total: 3 }, capability: { met: 0, total: 3 }, converged: false, status: 'building' as const, ...over.rollup },
    criteria: [], epics: [],
  };
}

const baseProps = {
  project: '/p/build123d', session: 'bsync', serverId: 'local',
  onDecideEscalation: vi.fn(), onAnswerPane: vi.fn(), onOpen: vi.fn(),
  now: Date.now(), subStatus: 'waiting' as const,
};

describe('ZenSessionCard mission ribbon', () => {
  it('daemon’s turn → ribbon shows building + green/at-rest header tint', () => {
    render(<ZenSessionCard {...baseProps} mission={mission()} />);
    const ribbon = screen.getByTestId('mission-ribbon');
    expect(ribbon.getAttribute('data-turn')).toBe('daemon');
    expect(ribbon.textContent).toContain('daemon building 1/3');
    // header tint = waiting/green (success), NOT amber
    expect(document.querySelector('.bg-success-300')).toBeTruthy();
    expect(document.querySelector('.bg-warning-300')).toBeNull();
  });

  it("conductor’s move (plan) → ribbon shows your-move + amber header tint", () => {
    render(<ZenSessionCard {...baseProps} mission={mission({ mission: { phase: "plan" }, rollup: { phase: "plan", mechanical: { done: 0, total: 0 }, status: "needs-discovery" as const } })} />);
    const ribbon = screen.getByTestId("mission-ribbon");
    expect(ribbon.getAttribute("data-turn")).toBe("conductor");
    expect(ribbon.textContent).toContain("your move");
    expect(document.querySelector(".bg-warning-300")).toBeTruthy(); // amber = your move
  });

  it('no mission → no ribbon', () => {
    render(<ZenSessionCard {...baseProps} mission={null} />);
    expect(screen.queryByTestId('mission-ribbon')).toBeNull();
  });

  it('a real escalation wins over conducting (red header, not amber/green)', () => {
    const escalation = { id: 'e1', project: '/p/build123d', session: 'bsync', status: 'open', questionText: 'pick one', options: [{ id: 'a', label: 'A' }] } as any;
    render(<ZenSessionCard {...baseProps} escalation={escalation} mission={mission()} />);
    // ribbon still present (it's still conducting) but the TINT is red (permission) — the
    // needs-you signal is never hidden by the conducting treatment.
    expect(screen.getByTestId('mission-ribbon')).toBeTruthy();
    expect(document.querySelector('.bg-danger-300')).toBeTruthy();
    expect(document.querySelector('.bg-success-300')).toBeNull(); // conducting green overridden
  });
});
