// Mobile-parity invariant for the Zen zones:
// every zone reads from HTTP read-models + WS only; no hover-to-reveal; tap is uniform.
// This file is self-contained and robust to sibling Z9 implementation timing —
// it only imports symbols confirmed to exist at blueprint authoring time.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZenMode } from '@/components/supervisor/zen/ZenMode';
import { useSupervisorStore, type SupervisedSession, type Escalation, type SessionSummary } from '@/stores/supervisorStore';
import { useSubscriptionStore, type SubscribedSession } from '@/stores/subscriptionStore';
import { useFreshnessStore } from '@/stores/freshnessStore';
import { selectTriageTop, selectTriageStack } from '@/lib/triageSelectors';
import { selectParagraphStack } from '@/lib/paragraphStack';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ZEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function zenSources(): { file: string; src: string }[] {
  return readdirSync(ZEN_DIR)
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('__'))
    .map((f) => ({ file: f, src: readFileSync(join(ZEN_DIR, f), 'utf8') }));
}

const NOW = 1_000_000_000_000;

const sess = (session: string, extra?: Partial<SupervisedSession>): SupervisedSession => ({
  project: '/repo',
  session,
  source: 'manual',
  serverId: 'srv1',
  ...extra,
});

const esc = (id: string, extra?: Partial<Escalation>): Escalation => ({
  id,
  project: '/repo',
  session: 's1',
  kind: 'decision',
  questionText: 'q?',
  status: 'open',
  createdAt: NOW - 60_000,
  serverId: 'srv1',
  ...extra,
});

const summary = (
  session: string,
  extra?: Partial<SessionSummary>,
): SessionSummary => ({
  project: '/repo',
  session,
  progressState: 'active',
  paneSeenAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  ...extra,
});

const subSess = (session: string, extra?: Partial<SubscribedSession>): SubscribedSession => ({
  serverId: 'srv1',
  project: '/repo',
  session,
  status: 'active',
  lastUpdate: NOW,
  ...extra,
});

// ─── A.1 No hover-to-reveal ──────────────────────────────────────────────────

describe('Zen mobile-parity — no hover-to-reveal', () => {
  // Cosmetic hovers (hover:bg-*, hover:text-*, dark:hover:*) ARE allowed.
  // Only reveal-gating patterns are forbidden.
  const DISALLOWED = [
    /group-hover:opacity/,
    /group-hover:block/,
    /group-hover:flex/,
    /group-hover:visible/,
    /onMouseEnter/,
    /onMouseOver/,
    /onMouseLeave/,
  ];

  for (const pattern of DISALLOWED) {
    it(`no "${pattern.source}" in any zen component`, () => {
      const offenders = zenSources()
        .filter(({ src }) => pattern.test(src))
        .map(({ file }) => file);
      expect(offenders).toEqual([]);
    });
  }
});

// ─── A.2 No direct network transport in zone render paths ────────────────────

describe('Zen mobile-parity — no direct network in zones', () => {
  const TRANSPORT_PATTERNS = [
    /new WebSocket\(/,
    /\bfetch\(/,
    /\baxios\b/,
    /EventSource\(/,
    /new EventSource/,
  ];

  for (const pattern of TRANSPORT_PATTERNS) {
    it(`no "${pattern.source}" in any zen component`, () => {
      const offenders = zenSources()
        .filter(({ src }) => pattern.test(src))
        .map(({ file }) => file);
      expect(offenders).toEqual([]);
    });
  }
});

// ─── A.3 Tap-uniform: every onClick lives on a <button ───────────────────────

describe('Zen mobile-parity — tap-uniform (buttons, not hover divs)', () => {
  it('every zen component with onClick uses <button', () => {
    const offenders = zenSources()
      .filter(({ src }) => src.includes('onClick') && !src.includes('<button'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

// ─── B. ZenMode renders purely from store state ──────────────────────────────

describe('Zen mobile-parity — ZenMode renders purely from store state', () => {
  beforeEach(() => {
    // Reset to known empty baseline (clears localStorage-hydrated bleed)
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [],
      escalations: [],
      supervised: [],
      todosByProject: {},
      sessionSummaries: {},
    });
    useSubscriptionStore.setState({ subscriptions: {}, order: [] });
    useFreshnessStore.setState({ lastWsMessageAt: NOW });
  });

  // The redesign renders ONE card per WATCHED session (subscriptions/order), so a
  // session must be subscribed to get a card; its summary enriches the card body.
  function seedSession(session: string, sum?: Partial<SessionSummary>): void {
    const key = `srv1:/repo:${session}`;
    useSubscriptionStore.setState({ subscriptions: { [key]: subSess(session) }, order: [key] });
    if (sum) {
      useSupervisorStore.setState({ sessionSummaries: { [`/repo::${session}`]: summary(session, sum) } });
    }
  }

  it('empty state when no sessions are watched', () => {
    render(<ZenMode />);
    expect(screen.getByText('No watched sessions')).toBeInTheDocument();
  });

  it('renders one card per watched session, showing the session name', () => {
    seedSession('my-session');
    render(<ZenMode />);
    expect(screen.getByTestId('zen-session-card')).toBeInTheDocument();
    expect(screen.getByText('my-session')).toBeInTheDocument();
  });

  it('card body shows the session paragraph from sessionSummaries', () => {
    seedSession('para-session', {
      structured: { paragraph: 'Currently implementing the auth module.', status: 'working' },
    });
    render(<ZenMode />);
    expect(screen.getByText('Currently implementing the auth module.')).toBeInTheDocument();
  });

  it('a needs-input session renders the question with selectable answers', () => {
    const key = `srv1:/repo:asking`;
    useSubscriptionStore.setState({ subscriptions: { [key]: subSess('asking') }, order: [key] });
    useSupervisorStore.setState({
      openEscalations: [esc('e-ask', { session: 'asking', questionText: 'Deploy now?',
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], recommended: 'yes' })],
      sessionSummaries: { '/repo::asking': summary('asking', { progressState: 'stalled' }) },
    });
    render(<ZenMode />);
    expect(screen.getByText('Deploy now?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No/ })).toBeInTheDocument();
  });

  it('each card has an Open button (bring the session up in full collab)', () => {
    seedSession('openable');
    render(<ZenMode />);
    const open = screen.getAllByRole('button').find((b) => /Open/.test(b.textContent || ''));
    expect(open).toBeDefined();
  });

  it('expanding a card collapses any other expanded one (single-open accordion)', () => {
    // Two sessions, both with a long paragraph (so each shows a "more" toggle).
    // Three sentences so the 2-sentence glance still leaves a third → a "more" toggle.
    const longPara = 'First sentence here. Second sentence with more detail. Third sentence to expand into.';
    useSubscriptionStore.setState({
      subscriptions: {
        'srv1:/repo:a': subSess('a'),
        'srv1:/repo:b': subSess('b'),
      },
      order: ['srv1:/repo:a', 'srv1:/repo:b'],
    });
    useSupervisorStore.setState({
      sessionSummaries: {
        '/repo::a': summary('a', { structured: { paragraph: longPara, status: 'working' } }),
        '/repo::b': summary('b', { structured: { paragraph: longPara, status: 'working' } }),
      },
    });
    render(<ZenMode />);
    const mores = screen.getAllByText('more');
    expect(mores.length).toBe(2); // both collapsed
    fireEvent.click(mores[0]); // expand A
    expect(screen.getAllByText('more').length).toBe(1); // A expanded → shows "less"
    fireEvent.click(screen.getAllByText('more')[0]); // expand B → A must collapse
    expect(screen.getAllByText('more').length).toBe(1); // still exactly one expanded
  });

  it('exposes an Exit Zen button (tap-uniform)', () => {
    render(<ZenMode />);
    const exit = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Exit Zen') || b.getAttribute('title')?.startsWith('Exit Zen'),
    );
    expect(exit).toBeDefined();
  });

  it('re-seeding store changes the view (pure function of store state)', () => {
    const { rerender } = render(<ZenMode />);
    expect(screen.queryByTestId('zen-session-card')).toBeNull();
    seedSession('dynamic-session', { summaryText: 'Working on feature X' });
    rerender(<ZenMode />);
    expect(screen.getByTestId('zen-session-card')).toBeInTheDocument();
    expect(screen.getByText('Working on feature X')).toBeInTheDocument();
  });
});

// ─── C. Z9 client behaviors via store + selectors ────────────────────────────

describe('Z9 client behaviors (existing API)', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [],
      escalations: [],
      supervised: [],
      todosByProject: {},
      sessionSummaries: {},
    });
    useSubscriptionStore.setState({ subscriptions: {}, order: [] });
    useFreshnessStore.setState({ lastWsMessageAt: NOW });
  });

  // C.1 — client-timer snooze
  describe('snoozeSession — client-timer exclusion + re-surface', () => {
    it('stamps snoozedUntil on the session summary', () => {
      const key = '/repo::wedged-1';
      useSupervisorStore.setState({
        sessionSummaries: {
          [key]: summary('wedged-1', { progressState: 'wedged', paneSeenAt: NOW - 30_000 }),
        },
      });
      const snoozedUntil = NOW + 10 * 60_000;
      useSupervisorStore.getState().snoozeSession('/repo', 'wedged-1', snoozedUntil);
      const stored = useSupervisorStore.getState().sessionSummaries[key];
      expect(stored.snoozedUntil).toBe(snoozedUntil);
    });

    it('snoozed session is excluded from triage stack while now < snoozedUntil', () => {
      const key = '/repo::wedged-2';
      const snoozedUntil = NOW + 10 * 60_000;
      useSupervisorStore.setState({
        sessionSummaries: {
          [key]: summary('wedged-2', {
            progressState: 'wedged',
            paneSeenAt: NOW - 30_000,
            snoozedUntil,
          }),
        },
      });
      const stack = selectTriageStack([], useSupervisorStore.getState().sessionSummaries, NOW);
      expect(stack.find((i) => i.kind === 'wedge')).toBeUndefined();
    });

    it('snoozed session re-surfaces once now >= snoozedUntil', () => {
      const snoozedUntil = NOW - 1; // already expired
      const key = '/repo::wedged-3';
      useSupervisorStore.setState({
        sessionSummaries: {
          [key]: summary('wedged-3', {
            progressState: 'wedged',
            paneSeenAt: NOW - 30_000,
            snoozedUntil,
          }),
        },
      });
      const stack = selectTriageStack([], useSupervisorStore.getState().sessionSummaries, NOW);
      expect(stack.find((i) => i.kind === 'wedge')).toBeDefined();
    });
  });

  // C.2 — operator-gated outranking
  describe('selectTriageTop — operator-gated outranking', () => {
    it('operator-gated escalation outranks a routine escalation', () => {
      const routine = esc('esc-routine', { operatorGated: false, createdAt: NOW - 1000 });
      const gated = esc('esc-gated', { operatorGated: true, createdAt: NOW - 500 });
      const top = selectTriageTop([routine, gated], {}, NOW);
      expect(top?.kind).toBe('escalation');
      expect((top as { escalation: Escalation }).escalation.id).toBe('esc-gated');
    });

    it('operator-gated escalation ties with wedged session at SEV_GATED_OR_WEDGED, older wins', () => {
      const gated = esc('esc-gated-tie', { operatorGated: true, createdAt: NOW - 2000 });
      const wedgedSummary = summary('wedged-tie', {
        progressState: 'wedged',
        paneSeenAt: NOW - 1000, // newer than escalation → gated should win (older since)
      });
      const sessionSummaries = { '/repo::wedged-tie': wedgedSummary };
      const top = selectTriageTop([gated], sessionSummaries, NOW);
      // Both share SEV_GATED_OR_WEDGED; tiebreak is age ASC (smallest since = oldest)
      expect(top?.kind).toBe('escalation'); // escalation.createdAt (NOW-2000) < paneSeenAt (NOW-1000)
    });

    it('wedged session wins the tie when it is older than the gated escalation', () => {
      const gated = esc('esc-gated-newer', { operatorGated: true, createdAt: NOW - 1000 });
      const wedgedSummary = summary('wedged-older', {
        progressState: 'wedged',
        paneSeenAt: NOW - 5000, // much older
      });
      const sessionSummaries = { '/repo::wedged-older': wedgedSummary };
      const top = selectTriageTop([gated], sessionSummaries, NOW);
      expect(top?.kind).toBe('wedge'); // paneSeenAt (NOW-5000) < createdAt (NOW-1000)
    });
  });

  // C.3 — paragraph-stack read-model
  describe('selectParagraphStack — ≤5 recency-sorted, paragraphs only', () => {
    it('returns at most 5 entries even when more summaries exist', () => {
      const summaries: Record<string, SessionSummary> = {};
      for (let i = 0; i < 8; i++) {
        const key = `/repo::sess-${i}`;
        summaries[key] = summary(`sess-${i}`, {
          summaryText: `summary ${i}`,
          summaryUpdatedAt: NOW - i * 1000,
        });
      }
      const stack = selectParagraphStack(summaries, 5);
      expect(stack.length).toBeLessThanOrEqual(5);
    });

    it('excludes sessions with no paragraph/summaryText/firstClause', () => {
      const summaries: Record<string, SessionSummary> = {
        '/repo::with-text': summary('with-text', { summaryText: 'has content' }),
        '/repo::no-text': summary('no-text'),
      };
      const stack = selectParagraphStack(summaries);
      expect(stack.map((m) => m.session)).toEqual(['with-text']);
    });

    it('returns entries recency-sorted (most-recent summaryUpdatedAt first)', () => {
      const summaries: Record<string, SessionSummary> = {
        '/repo::old': summary('old', { summaryText: 'old', summaryUpdatedAt: NOW - 10_000 }),
        '/repo::new': summary('new', { summaryText: 'new', summaryUpdatedAt: NOW - 1_000 }),
        '/repo::mid': summary('mid', { summaryText: 'mid', summaryUpdatedAt: NOW - 5_000 }),
      };
      const stack = selectParagraphStack(summaries);
      expect(stack.map((m) => m.session)).toEqual(['new', 'mid', 'old']);
    });

    it('includes structured.paragraph entries', () => {
      const summaries: Record<string, SessionSummary> = {
        '/repo::structured-only': summary('structured-only', {
          structured: { paragraph: 'para', status: 'working' },
        }),
      };
      const stack = selectParagraphStack(summaries);
      expect(stack).toHaveLength(1);
      expect(stack[0].session).toBe('structured-only');
    });
  });

  // C.4 — placeholder todos for not-yet-landed sibling Z9 actions
  it.todo('refreshSummaryNow — force-triggers a summary refresh (sibling deliverable)');
  it.todo('snoozeItem (optimistic clear/undo) — per-item snooze in the paragraph stack (sibling deliverable)');
  it.todo('setWatchdogThreshold — MCP call to update wedge threshold (sibling deliverable)');
});
