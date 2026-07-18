import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { useSupervisorStore, type SessionSummary } from '@/stores/supervisorStore';
import { useQuickReplyStore } from '@/stores/quickReplyStore';

/**
 * MessageComposer inline GHOST — Part 2 (replaces SuggestionChips). Verifies the
 * greyed inline suggestion renders over the EMPTY composer for a RECENT, same-session
 * payload; Tab accepts it into editable text; Enter-on-empty-with-ghost sends the EXACT
 * suggestion via /api/ide/tmux-send-keys; typing hides it; and a suggestion that is
 * stale (summaryUpdatedAt older than GHOST_MAX_AGE_MS), a 'working'-status payload
 * (pickGhost yields nothing), a cross-session payload, or one hidden by the Suggestions
 * toggle never renders.
 *
 * Freshness is RECENCY-based (summaryUpdatedAt within GHOST_MAX_AGE_MS), NOT
 * paneHash-equality — the live paneHash is always '' or advanced past summaryPaneHash,
 * so a paneHash gate is dead on real data.
 */

const PROPS = { project: 'p', session: 's', serverId: 'srv' };

const GHOST_MAX_AGE_MS = 5 * 60_000; // mirror MessageComposer's window

const BASE: SessionSummary = {
  project: 'p',
  session: 's',
  progressState: 'idle',
  paneSeenAt: 0,
  updatedAt: 0,
  // Live paneHash typically advances past the captured summaryPaneHash — the freshness
  // gate must NOT depend on their equality.
  paneHash: 'h2',
  summaryPaneHash: 'h1',
};

/** Seed a summary the way the store holds it. `summaryUpdatedAt` defaults to "now"
 *  (recent → fresh) unless an override supplies its own. */
function seed(structured: SessionSummary['structured'], overrides: Partial<SessionSummary> = {}, key = 'p::s') {
  useSupervisorStore.setState({
    sessionSummaries: { [key]: { ...BASE, summaryUpdatedAt: Date.now(), structured, ...overrides } },
  });
}

function lastFetchBody(): any {
  const calls = (globalThis.fetch as any).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

describe('MessageComposer ghost', () => {
  beforeEach(() => {
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useSupervisorStore.setState({ sessionSummaries: {} });
    useQuickReplyStore.setState({ sendOnEnter: false, suggestReplyDisplay: true }); // ghost sends regardless of Enter toggle; Suggestions on
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('(a) renders the recommended option as inline ghost text in the empty composer', () => {
    seed({
      paragraph: 'x', status: 'needs-input',
      options: [{ label: 'Yes', valueToSend: 'yes' }, { label: 'No', valueToSend: 'no' }],
      recommended: 0,
    });
    render(<MessageComposer {...PROPS} />);
    const ghost = screen.getByTestId('composer-ghost');
    expect(ghost.textContent).toBe('yes');
    // The real textarea stays empty — the ghost is an overlay, not typed text.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('(a2) renders suggestedAnswers[0] / aiOption and filters vacuous', () => {
    seed({ paragraph: 'x', status: 'idle', suggestedAnswers: ['ok', 'Push the branch'] });
    const { rerender } = render(<MessageComposer {...PROPS} />);
    expect(screen.getByTestId('composer-ghost').textContent).toBe('Push the branch');

    act(() => seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' }));
    rerender(<MessageComposer {...PROPS} />);
    expect(screen.getByTestId('composer-ghost').textContent).toBe('Run the tests');
  });

  it('(b) Tab accepts the ghost into the editable textarea value', () => {
    seed({ paragraph: 'x', status: 'idle', suggestedAnswers: ['Push the branch'] });
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(ta.value).toBe('Push the branch');
    expect(screen.queryByTestId('composer-ghost')).toBeNull(); // hidden once text present
    expect(globalThis.fetch).not.toHaveBeenCalled(); // accept never sends
  });

  it('(b2) ArrowRight at caret end accepts; clicking the ghost accepts', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    const { rerender } = render(<MessageComposer {...PROPS} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Run the tests');

    // Fresh mount → click-accept.
    act(() => {
      useSupervisorStore.setState({ sessionSummaries: {} });
      seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    });
    rerender(<MessageComposer {...PROPS} key="2" />);
    fireEvent.mouseDown(screen.getByTestId('composer-ghost'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Run the tests');
  });

  it('(c) Enter on the empty composer sends the EXACT ghost text to /api/ide/tmux-send-keys', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Enter' }); // toggle is OFF — the ghost overrides it
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/ide/tmux-send-keys');
    expect(init.method).toBe('POST');
    expect(lastFetchBody()).toEqual({
      project: 'p', session: 's', text: 'Run the tests', submit: true, quiet: true,
    });
    expect(ta.value).toBe(''); // cleared after send
  });

  it('(c2) the Send button sends the ghost from an empty composer', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    render(<MessageComposer {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(lastFetchBody().text).toBe('Run the tests');
  });

  it('(d) typing hides the ghost', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    render(<MessageComposer {...PROPS} />);
    expect(screen.getByTestId('composer-ghost')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my own message' } });
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });

  it('(e) a suggestion older than GHOST_MAX_AGE_MS does not render', () => {
    // Live paneHash is irrelevant now; staleness is time-based. A recent one WOULD show
    // (covered by (a)); this one is well past the window.
    seed(
      { paragraph: 'x', status: 'idle', aiOption: 'Run the tests' },
      { summaryUpdatedAt: Date.now() - (GHOST_MAX_AGE_MS + 10_000) },
    );
    render(<MessageComposer {...PROPS} />);
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });

  it('(e0) a missing summaryUpdatedAt is treated as not-fresh (no render)', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' }, { summaryUpdatedAt: undefined });
    render(<MessageComposer {...PROPS} />);
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });

  it("(e-working) a 'working'-status summary yields no ghost from pickGhost (no render)", () => {
    // Recent, same-session, focused, toggle on — but 'working' has no option/answer/aiOption.
    seed({ paragraph: 'x', status: 'working' });
    render(<MessageComposer {...PROPS} />);
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });

  it('(e-toggle) turning the Suggestions display toggle off hides the ghost', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    render(<MessageComposer {...PROPS} />);
    expect(screen.getByTestId('composer-ghost')).toBeTruthy(); // shown while on
    act(() => useQuickReplyStore.setState({ suggestReplyDisplay: false }));
    expect(screen.queryByTestId('composer-ghost')).toBeNull(); // hidden once off
  });

  it('(e2) a payload for another session does not render', () => {
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' }, {}, 'p::other');
    render(<MessageComposer {...PROPS} />);
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });

  it('(e3) no ghost when the window is not focused', () => {
    (document.hasFocus as any).mockReturnValue(false);
    seed({ paragraph: 'x', status: 'idle', aiOption: 'Run the tests' });
    render(<MessageComposer {...PROPS} />);
    expect(screen.queryByTestId('composer-ghost')).toBeNull();
  });
});
