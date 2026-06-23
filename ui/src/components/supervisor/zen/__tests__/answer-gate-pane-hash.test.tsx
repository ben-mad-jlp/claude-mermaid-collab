// Synthetic repro for the false-stale answer gate (fix f37be427).
//
// A Zen card whose interpreter REFRESH failed (refreshState 'stale-failing')
// used to hard-suppress its answer buttons and punt the user to "open the full
// UI" — even when the pane was UNCHANGED and the captured question was still on
// screen. The fix gates answering on a ground-truth signal: the question was
// captured at `summaryPaneHash`; `paneHash` is the live pane. Equal ⇒ the
// question is still up and safe to answer despite the failed refresh.
//
// These tests render the real ZenSessionCard and assert:
//   1. stale-failing + pane MATCHES → multi-select question is answerable, and
//      Submit fires onAnswerPaneMulti with the picked 1-based numbers.
//   2. stale-failing + pane MOVED → answering is suppressed (open-the-session
//      fallback), preserving the original safety behavior.
//   3. fresh + pane matches → answerable (unchanged baseline).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ZenSessionCard, type ZenSessionCardProps } from '@/components/supervisor/zen/ZenSessionCard';
import type { SessionSummary } from '@/stores/supervisorStore';

const NOW = 1_000_000_000_000;
const PANE = 'pane-hash-abc123';

const multiQuestionSummary = (extra?: Partial<SessionSummary>): SessionSummary => ({
  project: '/repo',
  session: 'parked',
  progressState: 'stalled',
  paneSeenAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  refreshState: 'stale-failing',
  // The carried question/options were captured at summaryPaneHash; paneHash is
  // the live pane. Default: equal (pane unchanged → question still on screen).
  paneHash: PANE,
  summaryPaneHash: PANE,
  structured: {
    paragraph: 'Waiting on a multi-select answer.',
    status: 'needs-input',
    question: 'Pick the options',
    multiSelect: true,
    options: [
      { label: 'Alpha', valueToSend: '1' },
      { label: 'Beta', valueToSend: '2' },
      { label: 'Gamma', valueToSend: '3' },
    ],
  },
  ...extra,
});

function renderCard(summary: SessionSummary, onAnswerPaneMulti = vi.fn().mockResolvedValue(true)) {
  const props: ZenSessionCardProps = {
    project: '/repo',
    session: 'parked',
    serverId: 'srv1',
    summary,
    // A session parked ON a question reads as needs-you, NOT active. (subStatus
    // === 'active' independently marks the interpreter stale — that's the "session
    // moved on / answered in its own terminal" case, out of scope here.)
    subStatus: 'permission',
    lastUpdate: NOW,
    now: NOW,
    onDecideEscalation: vi.fn(),
    onAnswerPane: vi.fn().mockResolvedValue(true),
    onAnswerPaneMulti,
    onOpen: vi.fn(),
  };
  render(<ZenSessionCard {...props} />);
  return { onAnswerPaneMulti, onOpen: props.onOpen };
}

describe('Zen answer gate — pane-hash ground truth (false-stale fix)', () => {
  it('stale-failing + pane MATCHES → multi-select is answerable; Submit fires onAnswerPaneMulti([1,2])', () => {
    const { onAnswerPaneMulti } = renderCard(multiQuestionSummary());

    // The question fills the card and the option buttons render (NOT the
    // "open the session" fallback).
    expect(screen.getByText('Pick the options')).toBeInTheDocument();
    expect(screen.queryByText(/open the session/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));

    const submit = screen.getByRole('button', { name: /^Submit/ });
    fireEvent.click(submit);

    expect(onAnswerPaneMulti).toHaveBeenCalledTimes(1);
    expect(onAnswerPaneMulti).toHaveBeenCalledWith('srv1', '/repo', 'parked', [1, 2]);
  });

  it('stale-failing + pane MOVED → answering suppressed, falls back to open-the-session', () => {
    const { onAnswerPaneMulti } = renderCard(
      multiQuestionSummary({ paneHash: 'pane-moved-on-xyz' }), // != summaryPaneHash
    );

    // No answerable question; the safety fallback is shown instead.
    expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull();
    expect(screen.getByText(/open the session/i)).toBeInTheDocument();
    expect(onAnswerPaneMulti).not.toHaveBeenCalled();
  });

  it('fresh + pane matches → answerable (baseline unchanged)', () => {
    renderCard(multiQuestionSummary({ refreshState: 'fresh' }));
    expect(screen.getByText('Pick the options')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByText(/open the session/i)).toBeNull();
  });
});
